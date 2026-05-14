import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Oral Examiner",
  description: "EHS Oral Examiner — voice-based oral defenses",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
