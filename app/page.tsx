"use client";

import React, { useEffect, useState } from "react";
import { ethers } from "ethers";

// BaggiezTickets on Linea Mainnet
const CONTRACT_ADDRESS = "0xc4Ab0d9FAcFAc11104E640718dCaB4df782428CC";

const CONTRACT_ABI = [
  "function mintPrice() view returns (uint256)",
  "function maxPerTx() view returns (uint256)",
  "function maxPerWallet() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function walletMints(address) view returns (uint256)",
  "function ticketsPer24h() view returns (uint256)",
  "function previewFreeMints(address) view returns (uint256)",
  "function mintTickets(uint256 quantity) payable",
];

// Linea PoH API + PoH completion URL
const POH_API_BASE = "https://poh-api.linea.build/poh/v2";
const POH_PORTAL_URL =
  "https://linea.build/hub/apps/sumsub-reusable-identity";

// TypeScript: allow window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);

  const [mintPrice, setMintPrice] = useState<ethers.BigNumber | null>(null);
  const [maxPerTx, setMaxPerTx] = useState<number>(0);
  const [maxPerWallet, setMaxPerWallet] = useState<number>(0);
  const [maxSupply, setMaxSupply] = useState<number>(0);
  const [totalSupply, setTotalSupply] = useState<number>(0);
  const [walletMints, setWalletMints] = useState<number>(0);
  const [ticketsPer24h, setTicketsPer24h] = useState<number>(0);

  const [quantity, setQuantity] = useState<number>(1);
  const [freeMintsRemaining, setFreeMintsRemaining] = useState<number | null>(
    null
  );
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [isMinting, setIsMinting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // PoH state
  const [isPohVerified, setIsPohVerified] = useState<boolean | null>(null);
  const [isCheckingPoh, setIsCheckingPoh] = useState<boolean>(false);

  // Auto-connect toggle (prevents reconnect after manual disconnect)
  const [autoConnectEnabled, setAutoConnectEnabled] = useState<boolean>(true);

  // -------------------------
  // Chain ID helper
  // -------------------------
  let numericChainId: number | null = null;
  if (chainId) {
    if (chainId.startsWith("0x") || chainId.startsWith("0X")) {
      numericChainId = parseInt(chainId, 16);
    } else {
      numericChainId = parseInt(chainId, 10);
    }
  }
  const isOnLineaMainnet = numericChainId === 59144; // Linea mainnet chain ID

  // -------------------------
  // PoH check helper
  // -------------------------

  const checkPohStatus = async (address: string) => {
    try {
      setIsCheckingPoh(true);
      setIsPohVerified(null);

      const res = await fetch(`${POH_API_BASE}/${address}`);
      if (!res.ok) {
        throw new Error(`PoH HTTP ${res.status}`);
      }

      const text = (await res.text()).trim(); // "true" or "false"
      const isHuman = text === "true";
      setIsPohVerified(isHuman);
    } catch (err) {
      console.error("PoH check failed:", err);
      setIsPohVerified(null);
      setErrorMessage((prev) => prev ?? "Could not check Proof of Humanity.");
    } finally {
      setIsCheckingPoh(false);
    }
  };

  // -------------------------
  // Connect / Disconnect wallet
  // -------------------------

  const connectWallet = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found. Please install it to mint.");
        return;
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      const selected = accounts[0];
      setWalletAddress(selected);

      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(cid);

      // Ensure auto-connect is enabled again after a manual connect
      setAutoConnectEnabled(true);

      // Load contract data + PoH after connect
      await Promise.all([
        loadContractData(selected),
        checkPohStatus(selected),
      ]);
    } catch (err: any) {
      console.error("Error connecting wallet:", err);
      setErrorMessage("Failed to connect wallet.");
    }
  };

  const disconnectWallet = () => {
    // We can't force MetaMask to "disconnect", but we can clear local state
    setWalletAddress(null);
    setChainId(null);
    setWalletMints(0);
    setFreeMintsRemaining(null);
    setIsPohVerified(null);
    setIsCheckingPoh(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    // Disable auto-connect so useEffect doesn't immediately reconnect
    setAutoConnectEnabled(false);
  };

  // -------------------------
  // Switch to Linea (Mainnet)
  // -------------------------

  const switchToLinea = async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setErrorMessage("MetaMask not found.");
      return;
    }

    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      // Try to switch first
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xe708" }], // 59144 in hex (Linea mainnet)
      });

      // If successful, refresh chainId and data
      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(cid);

      if (walletAddress) {
        await loadContractData(walletAddress);
        await checkPohStatus(walletAddress);
      }

      setSuccessMessage("Switched to Linea network.");
    } catch (switchError: any) {
      console.error("Error switching network:", switchError);

      // If the chain is not added to MetaMask
      if (switchError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xe708",
                chainName: "Linea",
                nativeCurrency: {
                  name: "Linea ETH",
                  symbol: "ETH",
                  decimals: 18,
                },
                rpcUrls: ["https://rpc.linea.build"],
                blockExplorerUrls: ["https://lineascan.build"],
              },
            ],
          });

          // After adding, try switching again
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xe708" }],
          });

          const cid = await window.ethereum.request({
            method: "eth_chainId",
          });
          setChainId(cid);

          if (walletAddress) {
            await loadContractData(walletAddress);
            await checkPohStatus(walletAddress);
          }

          setSuccessMessage("Linea network added and switched in your wallet.");
        } catch (addError: any) {
          console.error("Error adding Linea network:", addError);
          setErrorMessage(
            "Failed to add Linea network to your wallet. Please add it manually."
          );
        }
      } else if (switchError?.code === 4001) {
        // User rejected network switch
        setErrorMessage("Network switch was rejected in your wallet.");
      } else {
        setErrorMessage("Failed to switch network in MetaMask.");
      }
    }
  };

  // -------------------------
  // Load on-chain config + wallet data
  // -------------------------

  const loadContractData = async (address?: string | null) => {
    try {
      setIsLoadingData(true);
      setErrorMessage(null);

      if (typeof window === "undefined" || !window.ethereum) return;

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );

      const [mp, mpt, mpw, ts, ms, t24] = await Promise.all([
        contract.mintPrice(),
        contract.maxPerTx(),
        contract.maxPerWallet(),
        contract.totalSupply(),
        contract.maxSupply(),
        contract.ticketsPer24h(),
      ]);

      setMintPrice(mp);
      setMaxPerTx(mpt.toNumber());
      setMaxPerWallet(mpw.toNumber());
      setTotalSupply(ts.toNumber());
      setMaxSupply(ms.toNumber());
      setTicketsPer24h(t24.toNumber());

      if (address) {
        try {
          const wm = await contract.walletMints(address);
          setWalletMints(wm.toNumber());

          // Also preview free mints for this wallet
          const free = await contract.previewFreeMints(address);
          setFreeMintsRemaining(free.toNumber());
        } catch (inner) {
          console.warn("Could not load wallet-specific data:", inner);
        }
      }
    } catch (err: any) {
      console.error("Error loading contract data:", err);
      setErrorMessage("Error loading contract data. Check network & contract.");
    } finally {
      setIsLoadingData(false);
    }
  };

  // -------------------------
  // Mint
  // -------------------------

  const handleMint = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (typeof window === "undefined" || !window.ethereum) {
      setErrorMessage("MetaMask not found.");
      return;
    }
    if (!walletAddress) {
      setErrorMessage("Connect your wallet first.");
      return;
    }
    if (!isOnLineaMainnet) {
      setErrorMessage("Please switch your wallet network to Linea");
      return;
    }
    if (!mintPrice) {
      setErrorMessage("Mint price not loaded yet.");
      return;
    }
    if (quantity < 1) {
      setErrorMessage("Quantity must be at least 1.");
      return;
    }
    if (maxPerTx > 0 && quantity > maxPerTx) {
      setErrorMessage(`Max per transaction is ${maxPerTx}.`);
      return;
    }

    // Enforce PoH at UX layer
    if (isPohVerified === false) {
      setErrorMessage("You need to complete Proof of Humanity before minting.");
      return;
    }
    if (isPohVerified === null) {
      setErrorMessage(
        "Still checking your Proof of Humanity status. Please wait a moment and try again."
      );
      return;
    }

    try {
      setIsMinting(true);

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        CONTRACT_ABI,
        signer
      );

      // Re-check free mints on-chain right before mint, for safety
      let freeForThisTx = 0;
      if (freeMintsRemaining !== null) {
        freeForThisTx = Math.min(quantity, freeMintsRemaining);
      } else {
        const free = await contract.previewFreeMints(walletAddress);
        freeForThisTx = Math.min(quantity, free.toNumber());
      }

      const paidForThisTx = quantity - freeForThisTx;
      const requiredValue = mintPrice.mul(paidForThisTx);

      // PRE-CHECK: does the wallet have enough ETH for the mint value?
      if (paidForThisTx > 0) {
        const balance = await provider.getBalance(walletAddress);
        if (balance.lt(requiredValue)) {
          setErrorMessage("You need more ETH");
          setIsMinting(false);
          return;
        }
      }

      const tx = await contract.mintTickets(quantity, {
        value: requiredValue,
      });

      await tx.wait();

      setSuccessMessage("Mint successful!");
      // Reload contract + wallet data
      await loadContractData(walletAddress);
    } catch (err: any) {
      console.error("Mint error:", err);

      if (err?.code === "ACTION_REJECTED") {
        // User rejected in wallet
        setErrorMessage("Transaction rejected in wallet.");
      } else {
        // Inspect raw error text
        const rawMsg =
          err?.error?.message ||
          err?.data?.message ||
          err?.reason ||
          err?.message ||
          String(err ?? "");

        const lower = rawMsg.toLowerCase();

        if (
          lower.includes("insufficient funds") || // wallet doesn't have enough for tx + gas
          lower.includes("insufficient eth") // contract revert: "Insufficient ETH"
        ) {
          setErrorMessage("You need more ETH");
        } else if (
          lower.includes("24h") ||
          lower.includes("24 hours") ||
          lower.includes("daily") ||
          lower.includes("mint cap")
        ) {
          setErrorMessage("Mint cap reached, come back tomorrow.");
        } else {
          setErrorMessage(
            "Mint transaction failed. Check console for details."
          );
        }
      }
    } finally {
      setIsMinting(false);
    }
  };

  // -------------------------
  // Primary action (button) handler
  // -------------------------

  const handlePrimaryAction = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }

    if (!isOnLineaMainnet) {
      await switchToLinea();
      return;
    }

    if (isPohVerified === false) {
      // Send user to PoH flow
      window.open(POH_PORTAL_URL, "_blank");
      return;
    }

    await handleMint();
  };

  // -------------------------
  // Auto-load when wallet or chain changes
  // -------------------------

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWalletAddress(null);
        setWalletMints(0);
        setFreeMintsRemaining(null);
        setIsPohVerified(null);
      } else {
        const acc = accounts[0];
        setWalletAddress(acc);
        loadContractData(acc).catch(console.error);
        checkPohStatus(acc).catch(console.error);
      }
    };

    const handleChainChanged = (cid: string) => {
      setChainId(cid);
      if (walletAddress) {
        loadContractData(walletAddress).catch(console.error);
        checkPohStatus(walletAddress).catch(console.error);
      }
    };

    // On load or when autoConnectEnabled changes, check if already connected
    if (autoConnectEnabled) {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accounts: string[]) => {
          if (accounts.length > 0) {
            const acc = accounts[0];
            setWalletAddress(acc);
            loadContractData(acc).catch(console.error);
            checkPohStatus(acc).catch(console.error);
          }
        })
        .catch(console.error);
    }

    window.ethereum
      .request({ method: "eth_chainId" })
      .then((cid: string) => {
        setChainId(cid);
      })
      .catch(console.error);

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      if (!window.ethereum) return;
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [walletAddress, autoConnectEnabled]);

  // -------------------------
  // Derived values
  // -------------------------

  const formattedMintPrice = mintPrice
    ? ethers.utils.formatEther(mintPrice)
    : "---";

  const freeMintsText =
    freeMintsRemaining === null
      ? "Checking free mints..."
      : `${freeMintsRemaining} remaining (max 8 total)`;

  let paidForThisTx = 0;
  let ethCostForThisTx = "0";

  if (mintPrice) {
    const freeForThisTx =
      freeMintsRemaining !== null ? Math.min(quantity, freeMintsRemaining) : 0;
    paidForThisTx = quantity - freeForThisTx;
    const requiredValue = mintPrice.mul(paidForThisTx);
    ethCostForThisTx = ethers.utils.formatEther(requiredValue);
  }

  const buttonLabel = (() => {
    if (!walletAddress) return "Connect Wallet";
    if (!isOnLineaMainnet) return "Switch to Linea";
    if (isCheckingPoh) return "Checking PoH…";
    if (isPohVerified === false) return "Click here to verify POH";
    if (isMinting) return "Minting...";
    return "Mint Tickets";
  })();

  // Disable while busy (but not when PoH is false, so they can click the link)
  const isPrimaryDisabled = isMinting || isLoadingData || isCheckingPoh;

  // PoH label & class
  let pohLabel = "";
  let pohClass = "";

  if (isCheckingPoh) {
    pohLabel = "Checking...";
    pohClass = "checking";
  } else if (isPohVerified === true) {
    pohLabel = "Verified";
    pohClass = "ok";
  } else if (walletAddress) {
    pohLabel = "Not verified – required to mint";
    pohClass = "bad";
  }

  // -------------------------
  // Render
  // -------------------------

  return (
    <div className="page-root">
      {/* Floating background images */}
      <div className="bg-logo">
        <img src="/LogoTrans.png" alt="TBAG Logo" />
      </div>
      <div className="bg-img bg-img-1">
        <img src="/TBAG1trans.png" alt="TBAG 1" />
      </div>
      <div className="bg-img bg-img-2">
        <img src="/TBAG2trans.png" alt="TBAG 2" />
      </div>
      <div className="bg-img bg-img-3">
        <img src="/TBAG3trans.png" alt="TBAG 3" />
      </div>
      <div className="bg-img bg-img-4">
        <img src="/TBAG4trans.png" alt="TBAG 4" />
      </div>

      <div className="card-wrapper">
        <div className="mint-card">
          <div className="mint-card-header">
            <h1>T3 Baggiez Tickets</h1>
            <p>Secure your Baggiez tickets before they&apos;re gone.</p>
          </div>

          <div className="status-row">
            <span
              className={`status-pill ${isOnLineaMainnet ? "ok" : "bad"}`}
            >
              {isOnLineaMainnet ? "Linea" : "Wrong Network"}
            </span>

            <div className="status-right">
              <span className="status-address">
                {walletAddress
                  ? `Connected: ${walletAddress.slice(
                      0,
                      6
                    )}...${walletAddress.slice(-4)}`
                  : "Not connected"}
              </span>
              {walletAddress && (
                <button
                  className="disconnect-btn"
                  type="button"
                  onClick={disconnectWallet}
                >
                  Disconnect
                </button>
              )}
              {walletAddress && !isOnLineaMainnet && (
                <button
                  className="switch-network-btn"
                  type="button"
                  onClick={switchToLinea}
                >
                  Switch to Linea
                </button>
              )}
            </div>
          </div>

          {/* PoH status row */}
          {walletAddress && (
            <div className="poh-row">
              <span className="label">Proof of Humanity</span>
              <span className={`poh-tag ${pohClass}`}>{pohLabel}</span>
            </div>
          )}

          <div className="info-grid">
            <div className="info-box">
              <span className="label">Mint Price</span>
              <span className="value">{formattedMintPrice} ETH</span>
            </div>
            <div className="info-box">
              <span className="label">Supply</span>
              <span className="value">
                {totalSupply} / {maxSupply || 15000}
              </span>
            </div>
            <div className="info-box">
              <span className="label">Mint Limits</span>
              <span className="value">
                {maxPerTx} / tx · {maxPerWallet} / wallet
              </span>
            </div>
          </div>

          <div className="info-grid">
            <div className="info-box">
              <span className="label">24h Limit</span>
              <span className="value">
                {ticketsPer24h > 0 ? `${ticketsPer24h} tickets` : "No limit"}
              </span>
            </div>
            <div className="info-box">
              <span className="label">Your Mints</span>
              <span className="value">
                {walletAddress ? `${walletMints} minted` : "-"}
              </span>
            </div>
            <div className="info-box">
              <span className="label">Free mints</span>
              <span className="value small">{freeMintsText}</span>
            </div>
          </div>

          <div className="mint-controls">
            <div className="quantity-row">
              <span className="label">Quantity</span>
              <div className="quantity-controls">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1 || isMinting}
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  max={maxPerTx || 2}
                  value={quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value || "1", 10);
                    if (isNaN(val)) return;
                    setQuantity(Math.max(1, Math.min(val, maxPerTx || 2)));
                  }}
                />
                <button
                  onClick={() =>
                    setQuantity((q) => {
                      const next = q + 1;
                      return maxPerTx ? Math.min(next, maxPerTx) : next;
                    })
                  }
                  disabled={isMinting}
                >
                  +
                </button>
              </div>
            </div>

            <div className="cost-row">
              <span className="label">ETH for this tx</span>
              <span className="value">
                {mintPrice ? `${ethCostForThisTx} ETH` : "---"}
              </span>
            </div>

            <div className="actions-row">
              <button
                className="primary-btn"
                onClick={handlePrimaryAction}
                disabled={isPrimaryDisabled}
              >
                {buttonLabel}
              </button>
            </div>
          </div>

          {errorMessage && <div className="error-box">{errorMessage}</div>}
          {successMessage && (
            <div className="success-box">{successMessage}</div>
          )}

          {isLoadingData && (
            <div className="hint-text">Loading contract data from Linea…</div>
          )}
        </div>
      </div>

      <style jsx>{`
        .page-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at top, #1e293b 0, #020617 55%);
          color: #f9fafb;
          padding: 24px;
          position: relative;
          overflow: hidden;
          font-family: var(--font-barlow), system-ui, -apple-system,
            BlinkMacSystemFont, sans-serif;
        }

        .card-wrapper {
          position: relative;
          z-index: 2;
          max-width: 560px;
          width: 100%;
          margin-top: 40px; /* lowered card slightly so logo is more visible */
        }

        .mint-card {
          background: radial-gradient(
            circle at top left,
            #0f172a 0,
            #020617 60%
          );
          border-radius: 24px;
          padding: 24px 24px 28px;
          box-shadow: 0 0 60px rgba(129, 140, 248, 0.35),
            0 0 120px rgba(236, 72, 153, 0.25);
          border: 1px solid rgba(148, 163, 184, 0.5);
          backdrop-filter: blur(12px);
        }

        .mint-card-header h1 {
          font-size: 1.9rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 0;
          font-weight: 500;
        }

        .mint-card-header p {
          margin: 6px 0 0;
          font-size: 0.9rem;
          color: #cbd5f5;
        }

        .status-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
          gap: 8px;
          font-size: 0.8rem;
        }

        .status-pill {
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border: 1px solid rgba(148, 163, 184, 0.6);
        }

        .status-pill.ok {
          background: rgba(34, 197, 94, 0.12);
          border-color: rgba(34, 197, 94, 0.8);
          color: #bbf7d0;
        }

        .status-pill.bad {
          background: rgba(248, 113, 113, 0.1);
          border-color: rgba(248, 113, 113, 0.8);
          color: #fecaca;
        }

        .status-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
        }

        .status-address {
          opacity: 0.9;
          text-align: right;
        }

        .disconnect-btn,
        .switch-network-btn {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
          background: rgba(15, 23, 42, 0.9);
          color: #e5e7eb;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
        }

        .disconnect-btn:hover,
        .switch-network-btn:hover {
          background: rgba(30, 64, 175, 0.7);
        }

        /* PoH row */

        .poh-row {
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.78rem;
        }

        .poh-tag {
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
        }

        .poh-tag.ok {
          background: rgba(34, 197, 94, 0.12);
          border-color: rgba(34, 197, 94, 0.8);
          color: #bbf7d0;
        }

        .poh-tag.bad {
          background: rgba(248, 113, 113, 0.1);
          border-color: rgba(248, 113, 113, 0.8);
          color: #fecaca;
        }

        .poh-tag.checking {
          opacity: 0.9;
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 18px;
        }

        .info-box {
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: radial-gradient(
            circle at top left,
            rgba(79, 70, 229, 0.25),
            rgba(15, 23, 42, 0.8)
          );
        }

        .info-box:nth-child(2) {
          background: radial-gradient(
            circle at top,
            rgba(236, 72, 153, 0.25),
            rgba(15, 23, 42, 0.85)
          );
        }

        .info-box:nth-child(3) {
          background: radial-gradient(
            circle at top right,
            rgba(56, 189, 248, 0.25),
            rgba(15, 23, 42, 0.9)
          );
        }

        .label {
          display: block;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: #9ca3af;
          margin-bottom: 2px;
        }

        .value {
          font-size: 0.95rem;
          font-weight: 500;
        }

        .value.small {
          font-size: 0.8rem;
          line-height: 1.2;
        }

        .mint-controls {
          margin-top: 20px;
          border-top: 1px dashed rgba(148, 163, 184, 0.5);
          padding-top: 16px;
        }

        .quantity-row,
        .cost-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
          font-size: 0.88rem;
        }

        .quantity-controls {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
          padding: 2px;
        }

        .quantity-controls button {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: none;
          background: linear-gradient(135deg, #6366f1, #ec4899);
          color: white;
          cursor: pointer;
          font-size: 1rem;
        }

        .quantity-controls button:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .quantity-controls input {
          width: 48px;
          text-align: center;
          border: none;
          outline: none;
          background: transparent;
          color: #f9fafb;
          font-size: 0.9rem;
        }

        .actions-row {
          display: flex;
          margin-top: 12px;
        }

        .primary-btn {
          flex: 1;
          padding: 10px 14px;
          border-radius: 999px;
          border: none;
          font-size: 0.9rem;
          cursor: pointer;
          transition: transform 0.12s ease, box-shadow 0.12s ease,
            opacity 0.12s ease, background 0.12s ease;
          white-space: nowrap;
          background: linear-gradient(135deg, #6366f1, #ec4899);
          color: white;
          box-shadow: 0 12px 35px rgba(129, 140, 248, 0.6);
        }

        .primary-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 14px 40px rgba(129, 140, 248, 0.9);
        }

        .primary-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .error-box {
          margin-top: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.7);
          font-size: 0.8rem;
          color: #fecaca;
        }

        .success-box {
          margin-top: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.8);
          font-size: 0.8rem;
          color: #bbf7d0;
        }

        .hint-text {
          margin-top: 10px;
          font-size: 0.75rem;
          color: #9ca3af;
        }

        /* Background images */

        .bg-logo {
          position: absolute;
          top: -4%; /* moved logo further up */
          left: 50%;
          transform: translateX(-50%);
          opacity: 0.18;
          pointer-events: none;
          z-index: 0;
          animation: floatLogo 10s ease-in-out infinite alternate;
        }

        .bg-logo img {
          max-width: 350px; /* ~25% larger than before */
          height: auto;
        }

        .bg-img {
          position: absolute;
          opacity: 0.26;
          pointer-events: none;
          z-index: 0;
          animation-duration: 12s;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }

        .bg-img img {
          max-width: 340px;
          height: auto;
        }

        .bg-img-1 {
          top: 10%;
          left: 5%;
          animation-name: float1;
        }

        .bg-img-2 {
          bottom: 6%;
          left: 7%;
          animation-name: float2;
        }

        .bg-img-3 {
          top: 12%;
          right: 6%;
          animation-name: float3;
        }

        .bg-img-4 {
          bottom: 4%;
          right: 7%;
          animation-name: float4;
        }

        @keyframes floatLogo {
          0% {
            transform: translate(-50%, 0px) scale(1);
          }
          100% {
            transform: translate(-50%, -6px) scale(1.06);
          }
        }

        @keyframes float1 {
          0% {
            transform: translate(0px, 0px) rotate(-2deg) scale(1);
          }
          50% {
            transform: translate(10px, -6px) rotate(-4deg) scale(1.25);
          }
          100% {
            transform: translate(-4px, 4px) rotate(-3deg) scale(1.12);
          }
        }

        @keyframes float2 {
          0% {
            transform: translate(0px, 0px) rotate(2deg) scale(1.05);
          }
          50% {
            transform: translate(-12px, -10px) rotate(4deg) scale(1.25);
          }
          100% {
            transform: translate(8px, 6px) rotate(3deg) scale(1.08);
          }
        }

        @keyframes float3 {
          0% {
            transform: translate(0px, 0px) rotate(3deg) scale(0.78);
          }
          50% {
            transform: translate(-14px, 8px) rotate(5deg) scale(1.05);
          }
          100% {
            transform: translate(6px, -4px) rotate(4deg) scale(0.9);
          }
        }

        @keyframes float4 {
          0% {
            transform: translate(0px, 0px) rotate(-3deg) scale(1);
          }
          50% {
            transform: translate(12px, 10px) rotate(-5deg) scale(1.25);
          }
          100% {
            transform: translate(-6px, -6px) rotate(-4deg) scale(1.1);
          }
        }

        @media (max-width: 640px) {
          .mint-card {
            padding: 18px 16px 22px;
          }
          .mint-card-header h1 {
            font-size: 1.5rem;
          }
          .info-grid {
            grid-template-columns: 1fr;
          }
          .bg-logo img {
            max-width: 275px; /* also scale up on mobile */
          }
          .bg-img img {
            max-width: 240px;
          }
        }
      `}</style>
    </div>
  );
}
