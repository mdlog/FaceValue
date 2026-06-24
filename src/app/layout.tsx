import type { Metadata, Viewport } from "next";
import { Fraunces, Public_Sans, JetBrains_Mono } from "next/font/google";
import { TopNav } from "@/components/top-nav";
import { WalletProvider } from "@/lib/stellar/wallet";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FaceValue — Regulated, Private Ticket Resale",
  description:
    "Prove every ticket resale is at or below the public face-value cap — without revealing buyer, seller, or price. ZK enforcement on Stellar.",
};

export const viewport: Viewport = {
  themeColor: "#1a1714",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${publicSans.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="min-h-dvh">
        <WalletProvider>
          <TopNav />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
            <p className="rule-ink pb-4 font-mono text-[11px] leading-relaxed text-private">
              FaceValue · proof-of-concept for Stellar Hacks: Real-World ZK · ZK is
              load-bearing (resale_price ≤ public cap, Merkle membership, nullifier),
              verified in a Soroban contract on testnet. Some inputs are mocked and
              disclosed in the README.
            </p>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
