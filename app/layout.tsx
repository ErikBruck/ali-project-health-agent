import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ali · Project Health Agent",
  description: "Ali is an agentic, approval-gated project health workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const agentMode = process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL ? "model" : "local";
  return (
    <html lang="en">
      <body data-ali-mode={agentMode}>{children}</body>
    </html>
  );
}
