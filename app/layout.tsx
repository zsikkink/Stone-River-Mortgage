import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stone River Mortgage",
  description: "Purchase & refinance mortgage lending in Minnesota and Florida.",
  metadataBase: new URL("https://stonerivermortgage.com/"),
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico"
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
