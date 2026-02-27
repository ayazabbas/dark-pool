import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";
import { Button } from "./ui/button";
import { Wallet, LogOut } from "lucide-react";

export function ConnectButton() {
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (address) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => disconnect()}
        className="font-mono gap-2"
      >
        <div className="h-2 w-2 rounded-full bg-green animate-pulse" />
        <span className="hidden sm:inline">{address.slice(0, 6)}...{address.slice(-4)}</span>
        <span className="sm:hidden">{address.slice(0, 4)}..{address.slice(-3)}</span>
        <LogOut size={14} className="text-text-secondary" />
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      {connectors.map((connector) => (
        <Button
          key={connector.id}
          variant="default"
          size="sm"
          onClick={() => connect({ connector })}
          className="gap-2"
        >
          <Wallet size={14} />
          <span className="hidden sm:inline">
            {connector.id === "argentX" ? "ArgentX" : connector.id === "braavos" ? "Braavos" : connector.id}
          </span>
          <span className="sm:hidden">
            {connector.id === "argentX" ? "Argent" : connector.id === "braavos" ? "Braavos" : connector.id}
          </span>
        </Button>
      ))}
    </div>
  );
}
