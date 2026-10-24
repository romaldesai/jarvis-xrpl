import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "XRP2India",
  description: "Guardrailed US to India remittance agent on XRPL EVM Sidechain testnet",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
