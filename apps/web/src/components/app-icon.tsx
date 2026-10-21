import type { CSSProperties, ReactNode } from "react";

type IconName = "home" | "food" | "activity" | "progress" | "settings" | "camera";
const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  food: <><path d="M5 3v6m3-6v6M2 3v6a3 3 0 0 0 6 0M5 12v9M17 3c-3 3-4 7-4 10h5V3h-1Zm1 10v8" /></>,
  activity: <><path d="m4 15 5-6 4 3 6-8M15 4h4v4M4 21h16" /></>,
  progress: <><path d="M3 3v18h18M6 15l5-5 4 3 6-8" /><circle cx="11" cy="10" r="1" /></>,
  settings: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" /></>,
  camera: <><path d="M4 7h3l2-3h6l2 3h3v13H4Z" /><circle cx="12" cy="13" r="4" /></>,
};
export function AppIcon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
