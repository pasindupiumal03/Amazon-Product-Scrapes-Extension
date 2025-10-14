import React, { useState, useEffect } from "react";
import {
  saveToStorage,
  getFromStorage,
} from "./controllers/storageController.js";
import { createRoot } from "react-dom/client";
import "./index.css";


function Popup() {
  return <div className="w-full h-full bg-black text-white">
  </div>;
}

const root = createRoot(document.getElementById("react-target"));
root.render(<Popup />);