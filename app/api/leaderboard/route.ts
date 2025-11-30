import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

// Force Node runtime (just to be explicit)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const iface = new ethers.utils.Interface(BUY_ABI);

    // -----------------------------------
    // 1) Fetch all Buy logs via eth_getLogs
    // -----------------------------------
    const eventTopic = iface.getEventTopic("Buy");

    const fromBlockHex = "0x" + BUY_DEPLOY_BLOCK.toString(16);

    const logsBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          address: BUY_CONTRACT_ADDRESS,
          fromBlock: fromBlockHex,
          toBlock: "latest",
          topics: [eventTopic],
        },
      ],
    };

    const logsRes = await fetch(LINEA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logsBody),
    });

    if (!logsRes.ok) {
      const text = await logsRes.text();
      throw new Error(
        `eth_getLogs HTTP ${logsRes.status}: ${text.slice(0, 200)}`
      );
    }

    const logsJson = await logsRes.json();

    if (logsJson.error) {
      throw new Error(
        `eth_getLogs RPC error: ${logsJson.error.message || logsJson.error.code}`
      );
    }

    const rawLogs: { data: string; topics: string[] }[] = logsJson.result || [];

    // -----------------------------------
    // 2) Aggregate totalBuys per wallet
    // -----------------------------------
    const totals: Record<string, number> = {};

    for (const log of rawLogs) {
      const parsed = iface.parseLog(log);
      const user: string = parsed.args.user;
      if (!totals[user]) {
        totals[user] = 0;
      }
      totals[user] += 1; // 1 buy per event
    }

    // -----------------------------------
    // 3) Read maxBonusPercent via eth_call
    // -----------------------------------
    const callData = iface.encodeFunctionData("maxBonusPercent", []);

    const callBody = {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_call",
      params: [
        {
          to: BUY_CONTRACT_ADDRESS,
          data: callData,
        },
        "latest",
      ],
    };

    const callRes = await fetch(LINEA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(callBody),
    });

    if (!callRes.ok) {
      const text = await callRes.text();
      throw new Error(
        `eth_call HTTP ${callRes.status}: ${text.slice(0, 200)}`
      );
    }

    const callJson = await callRes.json();

    if (callJson.error) {
      throw new Error(
        `eth_call RPC error: ${callJson.error.message || callJson.error.code}`
      );
    }

    const maxBonusHex: string = callJson.result;
    const maxBonusPercent = ethers.BigNumber.from(maxBonusHex).toNumber();

    // -----------------------------------
    // 4) Build leaderboard rows
    // -----------------------------------
    const rows: LeaderboardRow[] = Object.entries(totals).map(
      ([wallet, totalBuys]) => {
        const bonusPercent = Math.min(
          Math.floor(totalBuys / 10), // 1% per 10 buys
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
