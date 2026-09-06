import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '林间筑梦 · Wildwood',
  description: '在松风谷地建造家园，体验天气与昼夜，守护你的林间小屋。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
