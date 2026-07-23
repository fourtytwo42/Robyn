"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function NetworkWalletControl() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        if (!connected) {
          return (
            <button
              className="wallet-control disconnected"
              type="button"
              onClick={openConnectModal}
            >
              Connect wallet
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button
              className="wallet-control wrong-network"
              type="button"
              onClick={openChainModal}
            >
              Switch to Robinhood Testnet
            </button>
          );
        }
        return (
          <button
            className="wallet-control connected"
            type="button"
            onClick={openAccountModal}
            aria-label={`Open ${account.displayName} wallet menu`}
          >
            {account.ensAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.ensAvatar} alt="" width={20} height={20} />
            ) : (
              <span className="wallet-identicon" aria-hidden="true" />
            )}
            <span>{account.displayName}</span>
            <small>Robinhood Testnet</small>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
