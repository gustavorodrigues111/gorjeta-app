import React from "react";
import ReactDOM from "react-dom/client";
import App, { AppErrorBoundary } from "./App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);
