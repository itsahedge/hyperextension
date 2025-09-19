import React from "react";

export function PopupContainer({ children }: { children: React.ReactNode }) {
  return <div className="popup-outer-container">{children}</div>;
}
