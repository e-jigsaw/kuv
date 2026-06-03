import type { ReactNode } from "react";
import "./tailwind.css";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {children}
    </div>
  );
}
