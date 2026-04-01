import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ramp Housing",
  description: "Find housing near Ramp HQ — compare 6 sources in one search",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
