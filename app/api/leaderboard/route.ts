import { NextResponse } from "next/server";
import { ethers } from "ethers";

// --------- Config ---------

// Linea RPC
const RPC_URL = process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// DoubleBagzV2 BUY contract on Linea mainnet
const BUY_CONTRACT_ADDRESS = "0x0E153774004835dcf78d7F8AE32bD00cF1743A7a";

// Optional: if you know the deployment block, put it here to speed things up.
// Using 0 is safe because we filter by address + event topic so logs stay small.
const DEPLOY_BLOCK = 0;

// How many blocks we scan per chunk (keeps each getLogs call small)
const CHUNK_SIZE_BLOCKS = 200_000;

// Dollar value per buy used for leaderboard bonus calc
const PRICE_PER_BUY_USD = 0.1;

// Buy event ABI – must match your DoubleBagzV2 contract
const BUY_EVENT_ABI =
  "event Buy(address indexed user, uint64 totalBuys, uint256 ethAmount, uint16 newBonusPercent)";

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
  bonusPercent: number;
  bonusValueUsd: number;
};

export async function GET() {
  try {
    // Important: StaticJsonRpcProvider with explicit network
    const provider = new ethers.providers.StaticJsonRpcProvider(
      RPC_URL,
      {
        chainId: 59144,
        name: "linea-mainnet",
      }
    );

    const iface = new ethers.utils.Interface([BUY_EVENT_ABI]);
    const latestBlock = await provider.getBlockNumber();

    // Event topic for Buy(...)
    const buyTopic = iface.getEventTopic("Buy");

    // Accumulate per-wallet stats
    const userStats = new Map<
      string,
      { totalBuys: number; bonusPercent: number }
    >();

    // Chunked scan to avoid 10k log limit
    for (
      let fromBlock = DEPLOY_BLOCK;
      fromBlock <= latestBlock;
      fromBlock += CHUNK_SIZE_BLOCKS + 1
    ) {
      const toBlock = Math.min(
        fromBlock + CHUNK_SIZE_BLOCKS,
        latestBlock
      );

      const logs = await provider.getLogs({
        address: BUY_CONTRACT_ADDRESS,
        fromBlock,
        toBlock,
        topics: [buyTopic],
      });

      for (const log of logs) {
        const parsed = iface.parseLog(log);
        const user: string = (parsed.args.user as string).toLowerCase();
        const totalBuysBn = parsed.args.totalBuys as ethers.BigNumber;
        const newBonusPercentBn = parsed.args
          .newBonusPercent as ethers.BigNumber;

        const totalBuys = totalBuysBn.toNumber();
        const bonusPercent = newBonusPercentBn.toNumber();

        // For each user, keep the latest totalBuys / bonusPercent we see
        userStats.set(user, {
          totalBuys,
          bonusPercent,
        });
      }
    }

    const rows: LeaderboardRow[] = [];

    for (const [wallet, { totalBuys, bonusPercent }] of userStats.entries()) {
      if (totalBuys === 0) continue;

      const base = totalBuys * PRICE_PER_BUY_USD; // $0.10 per buy
      const bonusValueUsd = base * (1 + bonusPercent / 100);

      rows.push({
        wallet,
        totalBuys,
        bonusPercent,
        bonusValueUsd,
      });
    }

    // Sort: highest totalBuys first, then highest bonusPercent
    rows.sort((a, b) => {
      if (b.totalBuys !== a.totalBuys) {
        return b.totalBuys - a.totalBuys;
      }
      return b.bonusPercent - a.bonusPercent;
    });

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err: any) {
    console.error("Leaderboard API error:", err);
    return NextResponse.json(
      {
        error: "Failed to build leaderboard",
        details: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
