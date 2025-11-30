import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const BUY_CONTRACT_ADDRESS = process.env.BUY_CONTRACT_ADDRESS;
const LINEA_RPC_URL = process.env.LINEA_RPC_URL;
const BUY_DEPLOY_BLOCK = process.env.BUY_DEPLOY_BLOCK
  ? Number(process.env.BUY_DEPLOY_BLOCK)
  : 0;

const BUY_ABI = [
  "event Buy(address indexed user,uint256 ethPaid,uint64 userTotalBuys,uint32 buysInCurrentWindow)",
  "function maxBonusPercent() view returns (uint16)",
];

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
  bonusPercent: number;
  bonusValueUsd: number;
};

export async function GET(req: NextRequest) {
  try {
    if (!LINEA_RPC_URL || !BUY_CONTRACT_ADDRESS || !BUY_DEPLOY_BLOCK) {
      return NextResponse.json(
        {
          error:
            "Missing LINEA_RPC_URL, BUY_CONTRACT_ADDRESS or BUY_DEPLOY_BLOCK env vars",
        },
        { status: 500 }
      );
    }

    // 🔥 Important change: pin Linea mainnet as the network
    const provider = new ethers.providers.StaticJsonRpcProvider(
      LINEA_RPC_URL,
      {
        chainId: 59144,
        name: "linea",
      }
    );

    const iface = new ethers.utils.Interface(BUY_ABI);

    // Read maxBonusPercent once
    const buyContract = new ethers.Contract(
      BUY_CONTRACT_ADDRESS,
      BUY_ABI,
      provider
    );
    const maxBonusPercentBn: ethers.BigNumber =
      await buyContract.maxBonusPercent();
    const maxBonusPercent = maxBonusPercentBn.toNumber();

    const eventTopic = iface.getEventTopic("Buy");

    const filter = {
      address: BUY_CONTRACT_ADDRESS,
      topics: [eventTopic],
      fromBlock: BUY_DEPLOY_BLOCK,
      toBlock: "latest" as any,
    };

    const logs = await provider.getLogs(filter);

    // Aggregate totals per wallet
    const totals: Record<string, number> = {};

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const user: string = parsed.args.user;
      if (!totals[user]) {
        totals[user] = 0;
      }
      totals[user] += 1;
    }

    const rows: LeaderboardRow[] = Object.entries(totals).map(
      ([wallet, totalBuys]) => {
        const bonusPercent = Math.min(
          Math.floor(totalBuys / 10),
          maxBonusPercent
        );
        const bonusValueUsd = totalBuys * 0.1; // $0.10 per buy

        return {
          wallet,
          totalBuys,
          bonusPercent,
          bonusValueUsd,
        };
      }
    );

    rows.sort((a, b) => b.totalBuys - a.totalBuys);

    const top100 = rows.slice(0, 100);

    return NextResponse.json({ rows: top100 });
  } catch (err: any) {
    console.error("Leaderboard error:", err);
    return NextResponse.json(
      {
        error: "Failed to build leaderboard",
        details: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
