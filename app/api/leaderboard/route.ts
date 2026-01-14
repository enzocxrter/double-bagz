import { NextResponse } from "next/server";
import { ethers } from "ethers";

// --------- Config ---------

// Linea RPC – can be overridden in Vercel env if you add LINEA_RPC_URL
const RPC_URL = process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// DoubleBagzV2 BUY contract on Linea mainnet
const BUY_CONTRACT_ADDRESS = "0x0E153774004835dcf78d7F8AE32bD00cF1743A7a";

// If you know the deploy block, set it here to speed things up.
// 0 is safe because we filter by address + topic.
const DEPLOY_BLOCK = 0;

// How many blocks per chunk (to avoid 10k log limit)
const CHUNK_SIZE_BLOCKS = 200_000;

// $ value per buy used for bonus calculation
const PRICE_PER_BUY_USD = 0.1;

// ✅ REAL Buy event ABI from LineaScan
// Buy (index_topic_1 address user, uint256 ethPaid, uint64 userTotalBuys, uint32 buysInCurrentWindow)
const BUY_EVENT_ABI =
  "event Buy(address indexed user, uint256 ethPaid, uint64 userTotalBuys, uint32 buysInCurrentWindow)";

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
  bonusPercent: number;
  bonusValueUsd: number;
};

// Helper to call JSON-RPC directly with fetch
async function callRpc(method: string, params: any[]): Promise<any> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `RPC HTTP ${res.status} for ${method} – body: ${text || "<empty>"}`
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch (e: any) {
    throw new Error(`RPC ${method} invalid JSON response: ${e?.message || e}`);
  }

  if (json.error) {
    throw new Error(
      `RPC ${method} error: ${
        json.error.message || JSON.stringify(json.error)
      }`
    );
  }

  return json.result;
}

export async function GET() {
  try {
    const iface = new ethers.utils.Interface([BUY_EVENT_ABI]);
    const buyTopic = iface.getEventTopic("Buy");

    // 1) Get latest block number via raw RPC
    const latestBlockHex: string = await callRpc("eth_blockNumber", []);
    const latestBlock = parseInt(latestBlockHex, 16);

    if (Number.isNaN(latestBlock)) {
      throw new Error(
        `Could not parse latest block number from result: ${latestBlockHex}`
      );
    }

    // 2) Accumulate per-wallet stats
    const userStats = new Map<
      string,
      { totalBuys: number; bonusPercent: number }
    >();

    // Chunked scan over the chain
    for (
      let fromBlock = DEPLOY_BLOCK;
      fromBlock <= latestBlock;
      fromBlock += CHUNK_SIZE_BLOCKS + 1
    ) {
      const toBlock = Math.min(
        fromBlock + CHUNK_SIZE_BLOCKS,
        latestBlock
      );

      const fromHex = "0x" + fromBlock.toString(16);
      const toHex = "0x" + toBlock.toString(16);

      const filter = {
        address: BUY_CONTRACT_ADDRESS,
        fromBlock: fromHex,
        toBlock: toHex,
        topics: [buyTopic],
      };

      const logs: any[] = await callRpc("eth_getLogs", [filter]);

      for (const log of logs) {
        // ethers expects { topics: string[], data: string }
        const parsed = iface.parseLog({
          topics: log.topics,
          data: log.data,
        });

        const user: string = (parsed.args.user as string).toLowerCase();

        // From the real event:
        //   address user
        //   uint256 ethPaid
        //   uint64 userTotalBuys
        //   uint32 buysInCurrentWindow
        const userTotalBuysBn = parsed.args.userTotalBuys as ethers.BigNumber;

        const totalBuys = userTotalBuysBn.toNumber();

        // For now we don't have bonus in the event, so we default to 0 here.
        // (Your per-user bonus still shows correctly in the UI via direct contract reads.)
        const bonusPercent = 0;

        userStats.set(user, {
          totalBuys,
          bonusPercent,
        });
      }
    }

    // 3) Build leaderboard rows
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

    // Sort by buys desc, then bonus desc
    rows.sort((a, b) => {
      if (b.totalBuys !== a.totalBuys) return b.totalBuys - a.totalBuys;
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
