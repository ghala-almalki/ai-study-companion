"""
This file is the web API: the (door) of the backend
The frontend talks to these endpoints:
    GET    /files/              list the uploaded files
    POST   /upload/             upload PDF or text files
    DELETE /delete/{filename}   delete a file
    POST   /chat/               ask a question about the selected files
    POST   /summarize/          summarize the selected files

This file does no AI work itself it checks the request is safe
then calls processing.py (search + Gemini)
"""

import logging
import os
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.processing import (
    EmptyDocumentError,
    ask_question,
    remove_from_cache,
    summarize_documents,
)

load_dotenv()
logger = logging.getLogger(__name__)

############### Settings ##############

# The uploads folder sits in the project root next to the (backend) folder
# We build the path from this file's location so it works from any start folder
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploaded_files")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = (".pdf", ".txt")
MAX_FILE_MB = 20
MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
CHUNK_SIZE = 1024 * 1024  # we read uploads 1 MB at a time
MAX_FILES_PER_REQUEST = 20
MAX_QUESTION_LENGTH = 2000

# Characters that are not allowed in a file name (they are dangerous on Windows)
INVALID_FILENAME_CHARS = set('<>:"|?*\x00')

############### App setup ##############

app = FastAPI(title="AI Study Companion API")

# CORS: only these websites may call our API from a browser
# Add more in .env, separated by commas, for example:
# ALLOWED_ORIGINS=http://localhost:3000,https://my-site.com
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,  # we do not use cookies so we keep this off
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


class ChatRequest(BaseModel):
    """Body of /chat/: a question and the files to search in."""

    question: str = Field(..., min_length=1, max_length=MAX_QUESTION_LENGTH)
    filenames: List[str] = Field(..., min_length=1, max_length=MAX_FILES_PER_REQUEST)


class SummarizeRequest(BaseModel):
    """Body of /summarize/: only the files (no question needed)."""

    filenames: List[str] = Field(..., min_length=1, max_length=MAX_FILES_PER_REQUEST)


############### Helpers ##############


def clean_filename(name: str) -> str:
    """Return a safe file name, or an empty string if the name is not usable."""
    # basename removes any folder part: "../../secret.txt" becomes "secret.txt"
    name = os.path.basename(name.replace("\\", "/")).strip()
    if name in ("", ".", "..") or any(ch in INVALID_FILENAME_CHARS for ch in name):
        return ""
    return name


def get_safe_path(filename: str) -> str:
    """Return the full path of a file inside UPLOAD_DIR, or raise 400 if unsafe."""
    # The name must already be clean. We reject it instead of silently fixing it
    if not filename or clean_filename(filename) != filename:
        raise HTTPException(400, "Invalid file name")

    path = os.path.join(UPLOAD_DIR, filename)

    # Second safety layer the final location must be directly inside UPLOAD_DIR
    if os.path.dirname(os.path.realpath(path)) != os.path.realpath(UPLOAD_DIR):
        raise HTTPException(400, "Invalid file name")
    return path


def get_existing_paths(filenames: List[str]) -> List[str]:
    """Convert file names to safe paths and make sure every file exists."""
    paths = []
    for name in filenames:
        path = get_safe_path(name)
        if not os.path.exists(path):
            raise HTTPException(404, f"{name} not found")
        paths.append(path)
    return paths


def save_upload(upload: UploadFile, path: str) -> None:
    """Save an uploaded file safely (size limit, real PDF check, no half files)."""
    # We write to a temporary file first if anything fails the old file is untouched
    tmp_path = path + ".part"
    total = 0
    try:
        with open(tmp_path, "wb") as out:
            while chunk := upload.file.read(CHUNK_SIZE):
                # A real PDF always starts with these 4 bytes
                if total == 0 and path.lower().endswith(".pdf") and not chunk.startswith(b"%PDF"):
                    raise HTTPException(400, "This file is not a real PDF")
                total += len(chunk)
                if total > MAX_FILE_BYTES:
                    raise HTTPException(413, f"File is too large (max {MAX_FILE_MB} MB)")
                out.write(chunk)
        if total == 0:
            raise HTTPException(400, "The file is empty")
        os.replace(tmp_path, path)
    except Exception:
        # Remove the half-written file then pass the error up
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


############## Endpoints ###############


@app.get("/files/")
def list_files():
    """Return the names of the files that are in the uploads folder."""
    # We read the folder itself so the list is still correct after a restart
    return sorted(
        name
        for name in os.listdir(UPLOAD_DIR)
        if name.lower().endswith(ALLOWED_EXTENSIONS)
    )


@app.post("/upload/")
def upload_files(files: List[UploadFile] = File(...)):
    """Save one or more PDF / text files."""
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(400, f"Too many files (max {MAX_FILES_PER_REQUEST})")

    # Check every name first so we never save only half of the files
    targets = []
    for file in files:
        name = clean_filename(file.filename or "")
        if not name or not name.lower().endswith(ALLOWED_EXTENSIONS):
            raise HTTPException(400, "Only PDF or text files allowed")
        targets.append((file, name))

    saved = []
    for file, name in targets:
        path = get_safe_path(name)
        save_upload(file, path)
        # If a file with the same name was uploaded before forget its old index
        remove_from_cache(path)
        saved.append(name)

    return {"status": "success", "files": saved}


@app.delete("/delete/{filename}")
def delete_file(filename: str):
    """Delete an uploaded file and its cached index."""
    path = get_safe_path(filename)
    if not os.path.exists(path):
        raise HTTPException(404, "File not found")

    os.remove(path)
    remove_from_cache(path)
    return {"status": "success", "message": f"{filename} deleted"}


@app.post("/chat/")
def chat(req: ChatRequest):
    """Answer a question using the selected files."""
    if not req.question.strip():
        raise HTTPException(400, "Question is empty")

    paths = get_existing_paths(req.filenames)

    try:
        result = ask_question(paths, req.question)
    except Exception:
        # The real error goes to the server log the user sees a safe message
        logger.exception("Chat request failed")
        raise HTTPException(500, "Failed to answer the question. Please try again.")

    return {"answer": result["answer"], "used_context": result["context"]}


@app.post("/summarize/")
def summarize(req: SummarizeRequest):
    """Summarize the whole content of the selected files."""
    paths = get_existing_paths(req.filenames)

    try:
        return {"summary": summarize_documents(paths)}
    except EmptyDocumentError:
        # For example a scanned PDF that has only images and no real text
        raise HTTPException(400, "No text could be extracted from the file")
    except Exception:
        logger.exception("Summarize request failed")
        raise HTTPException(500, "Failed to summarize the file. Please try again.")