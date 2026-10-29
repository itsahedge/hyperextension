import { useState } from "react";
import { Button } from "./ui";

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-raised p-2">
      <span className="min-w-0 flex-1 font-mono text-[11px] break-all">{address}</span>
      <Button
        size="sm"
        onClick={() =>
          navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
