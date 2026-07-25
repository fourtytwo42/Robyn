"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const LAUNCH_TOKEN_EVENT = "sherwood:open-launch";

type LaunchTokenTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "onClick"
> & {
  children: ReactNode;
};

export function LaunchTokenTrigger({
  children,
  ...props
}: LaunchTokenTriggerProps) {
  return (
    <button
      {...props}
      type="button"
      onClick={() => window.dispatchEvent(new Event(LAUNCH_TOKEN_EVENT))}
    >
      {children}
    </button>
  );
}
