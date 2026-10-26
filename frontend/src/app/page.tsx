"use client";

/**
 * Home page of the website, the whole interface lives in this file
 *
 * What the user can do here:
 *  - upload PDF / text files        (POST   /upload/)
 *  - see and delete the files       (GET    /files/, DELETE /delete/{name})
 *  - ask a question about a file    (POST   /chat/)
 *  - get a summary of a file        (POST   /summarize/)
 *
 * All the AI work happens in the Python backend
 * This file only sends requests and shows the answers
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Copy, Trash2, SendHorizonal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Address of the Python backend
// It can be changed with NEXT_PUBLIC_API_URL (see .env.example)
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

// Longest question we allow. It must match MAX_QUESTION_LENGTH in backend/api.py
const MAX_QUESTION_LENGTH = 2000;

// When the page opens the backend may still be starting (it needs some seconds
// to load the AI models) We try to load the files several times before giving up
const LOAD_FILES_ATTEMPTS = 10;
const LOAD_FILES_RETRY_MS = 3000;

// Who wrote a chat message
type Sender = "user" | "bot" | "system";
type Message = { sender: Sender; text: string };

// Read the error text that the backend sends or build a simple one
function readApiError(data: unknown, status: number): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    // Our own errors send a text. Validation errors send a list so we skip them
    if (typeof detail === "string") return detail;
  }
  return `Request failed (error ${status})`;
}

// Get the text of an error or a fallback text if it is not a normal Error
function errorText(err: unknown, fallback = ""): string {
  return err instanceof Error ? err.message : fallback;
}

// Send a request to the backend and return its JSON answer
// A plain fetch does NOT fail when the backend answers with an error code
// (400, 404, 500...) this helper throws an Error in that case
async function callApi<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, options);
  } catch {
    throw new Error("Cannot reach the server. Make sure the backend is running.");
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // The answer was not JSON. We handle this below
  }

  if (!res.ok) throw new Error(readApiError(data, res.status));
  return data as T;
}

export default function Home() {
  const [fileNames, setFileNames] = useState<string[]>([]);
  // the selected file by its NAME not by its position
  // so the choice stays correct when the list changes
  const [selectedFile, setSelectedFile] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  // True while we wait for the backend (upload, answer, summary, delete)
  const [isLoading, setIsLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Add one message to the chat
  const addMessage = (sender: Sender, text: string) =>
    setMessages((prev) => [...prev, { sender, text }]);

  // Get the file list from the backend and keep the selected file valid
  // Returns true if it worked false if the backend could not be reached
  const fetchFiles = useCallback(async (): Promise<boolean> => {
    try {
      const names = await callApi<string[]>("/files/");
      setFileNames(names);
      // If the selected file does not exist anymore select the first one
      setSelectedFile((current) =>
        names.includes(current) ? current : (names[0] ?? "")
      );
      return true;
    } catch (err) {
      // console.warn, not console.error: a failed first try is normal
      // while the backend is still starting
      console.warn("Failed to fetch files", err);
      return false;
    }
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const formData = new FormData();
    Array.from(e.target.files).forEach((file) => formData.append("files", file));
    // Reset the input so the same file can be chosen again later
    e.target.value = "";

    setIsLoading(true);
    try {
      await callApi("/upload/", { method: "POST", body: formData });
      await fetchFiles();
      addMessage("system", "The file has been uploaded successfully ✅");
    } catch (err) {
      addMessage("system", `File upload failed ❌ ${errorText(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    setIsLoading(true);
    try {
      // encodeURIComponent keeps names with spaces or special characters safe in the URL
      await callApi(`/delete/${encodeURIComponent(name)}`, { method: "DELETE" });
      await fetchFiles();
      addMessage("system", `The file has been deleted 🗑️: ${name}`);
    } catch (err) {
      addMessage("system", `Could not delete the file ❌ ${errorText(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question) return;
    if (!selectedFile) {
      addMessage("system", "Please upload a file first 📄");
      return;
    }

    addMessage("user", question);
    setInput("");
    setIsLoading(true);
    try {
      const data = await callApi<{ answer: string }>("/chat/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, filenames: [selectedFile] }),
      });
      addMessage("bot", data.answer);
    } catch (err) {
      addMessage("bot", errorText(err, "An error occurred during processing."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!selectedFile) {
      addMessage("system", "Please upload a file first 📄");
      return;
    }

    setIsLoading(true);
    try {
      const data = await callApi<{ summary: string }>("/summarize/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: [selectedFile] }),
      });
      addMessage("bot", data.summary);
    } catch (err) {
      addMessage("bot", errorText(err, "Summarization failed"));
    } finally {
      setIsLoading(false);
    }
  };

  // Keep the chat scrolled to the newest message
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  // Load the file list when the page opens
  // If the backend is not ready yet try again a few times before showing a message
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (attempt: number) => {
      const ok = await fetchFiles();
      if (ok || cancelled) return;
      if (attempt < LOAD_FILES_ATTEMPTS) {
        timer = setTimeout(() => load(attempt + 1), LOAD_FILES_RETRY_MS);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "system", text: "Cannot reach the server. Make sure the backend is running." },
        ]);
      }
    };

    load(1);
    // Cleanup stop trying if the page is closed
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchFiles]);

  // Color of the grid lines in the page background
  const gridColor = darkMode ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)";

  // ############## Splash screen ##############
  if (showSplash) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Start"
        onClick={() => setShowSplash(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setShowSplash(false);
        }}
        className="h-screen w-full flex flex-col justify-center items-center cursor-pointer bg-gradient-to-br from-purple-200 to-teal-100 dark:from-gray-900 dark:to-gray-800 px-4"
      >
        <img src="/logo.png" alt="Blink Logo" className="w-24 h-24 mb-4 motion-safe:animate-bounce" />
        <h1 className="text-xl text-center font-semibold text-purple-700 dark:text-purple-300 font-mono tracking-tight animate-pulse">
          Blink and boom <span className="text-teal-500">..</span> you got it!
        </h1>
        <p className="text-[10px] mt-3 text-gray-600 dark:text-gray-300 font-mono">Just press..and Blink begins</p>
      </div>
    );
  }

  // ############## Main page ##############
  return (
    // The (dark) class makes every dark style below work in dark mode
    <div
      className={`h-dvh overflow-hidden transition-colors duration-300 ${
        darkMode ? "dark bg-gray-900 text-white" : "bg-[#f9fafb] text-gray-900"
      }`}
      style={{
        backgroundImage: `
          linear-gradient(to right, ${gridColor} 1px, transparent 1px),
          linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="max-w-3xl mx-auto p-4 flex flex-col gap-4 h-full">
        {/* Header: logo and name and the dark mode button */}
        <header className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Blink Logo" className="w-10 h-10 animate-bounce" />
            <motion.h1
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="text-3xl font-extrabold text-purple-600 dark:text-purple-400"
            >
              Blink
            </motion.h1>
          </div>
          <button
            type="button"
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setDarkMode(!darkMode)}
            className="hover:bg-transparent focus:outline-none focus:ring-0 focus:ring-offset-0 transition-transform hover:scale-110 text-2xl"
          >
            {darkMode ? "🌙" : "☀️"}
          </button>
        </header>

        {/*  summary button and upload button and the list of files */}
        <div className="shrink-0 flex flex-wrap gap-2 items-center justify-end flex-col-reverse md:flex-row-reverse md:items-stretch">
          <Button
            className="bg-teal-500 hover:bg-teal-600 text-white w-full md:w-1/6 h-10 rounded-lg flex items-center justify-center text-sm"
            onClick={handleSummarize}
            disabled={isLoading}
          >
            {isLoading ? "..." : "summary"}
          </Button>

          <label
            aria-label="Upload files"
            title="Upload files"
            className="flex items-center justify-center w-full md:w-1/6 h-10 bg-purple-600 text-white rounded-lg cursor-pointer hover:bg-purple-700 transition"
          >
            <Upload size={18} />
            {/* The backend accepts only PDF and text files */}
            <Input
              type="file"
              multiple
              accept=".pdf,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>

          <div className="bg-white dark:bg-gray-800 rounded-xl border p-3 w-full md:w-1/3 h-24 overflow-y-auto">
            {fileNames.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">There are no files</p>
            ) : (
              fileNames.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <span
                    className={`cursor-pointer truncate text-sm transition-all duration-300 ${
                      selectedFile === name ? "font-bold text-purple-500 scale-105" : ""
                    }`}
                    onClick={() => setSelectedFile(name)}
                  >
                    {name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete ${name}`}
                    onClick={() => handleDelete(name)}
                    disabled={isLoading}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Chat: all the messages */}
        <div
          // flex-col is needed for self-start - self-end - self-center to work
          className="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-gradient-to-b from-teal-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-4 space-y-4"
          ref={chatRef}
        >
          <AnimatePresence>
            {messages.map((msg, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: msg.sender === "user" ? 100 : -100 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className={`max-w-[70%] p-3 rounded-xl relative group flex items-start gap-2 ${
                  msg.sender === "system"
                    ? "bg-yellow-200 text-gray-800 self-start"
                    : msg.sender === "user"
                    ? "bg-teal-400 text-white self-end"
                    : "bg-purple-400 text-white self-start"
                }`}
              >
                {/* dir="auto": Arabic text goes right to left and English left to right
                    whitespace pre wrap: keeps the line breaks of the answer */}
                <div dir="auto" className="flex-1 whitespace-pre-wrap break-words">
                  {msg.text}
                  {msg.sender !== "system" && (
                    <motion.button
                      type="button"
                      aria-label="Copy message"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:scale-110"
                      // clipboard can be missing on some connections so we do not crash
                      onClick={() => navigator.clipboard?.writeText(msg.text).catch(() => {})}
                    >
                      <Copy size={14} />
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ))}

            {/* The three bouncing dots while we wait for the backend */}
            {isLoading && (
              <motion.div
                key="loading-dots"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="self-start flex gap-1 items-center px-4 py-2 bg-purple-200 text-purple-900 rounded-xl w-fit animate-pulse"
              >
                <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce [animation-delay:.1s]" />
                <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce [animation-delay:.2s]" />
                <div className="w-2 h-2 bg-purple-600 rounded-full animate-bounce [animation-delay:.3s]" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* question box and send button */}
        <div className="shrink-0 flex items-center gap-2">
          <Textarea
            dir="auto"
            aria-label="Your question"
            maxLength={MAX_QUESTION_LENGTH}
            className="flex-1 resize-none p-3 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
            value={input}
            placeholder="Write your question..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends the question, Shift+Enter makes a new line
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
          />
          <Button
            aria-label="Send"
            className="bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-xl transition"
            onClick={handleSend}
            disabled={isLoading || input.trim() === ""}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <SendHorizonal className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}