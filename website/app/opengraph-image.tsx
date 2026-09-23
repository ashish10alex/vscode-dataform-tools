import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const logo = fs.readFileSync(path.join(process.cwd(), "public", "logo.png")).toString("base64");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0c0e13",
          backgroundImage:
            "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(59,130,246,0.28), transparent 70%), linear-gradient(to right, #161a22 1px, transparent 1px), linear-gradient(to bottom, #161a22 1px, transparent 1px)",
          backgroundSize: "100% 100%, 44px 44px, 44px 44px",
          color: "#f5f7fa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <img src={`data:image/png;base64,${logo}`} width={72} height={72} alt="" />
          <span style={{ fontSize: 40, fontWeight: 600 }}>{site.name}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5 }}>
            See what your Dataform code will do — before it runs.
          </span>
          <span style={{ fontSize: 28, color: "#9aa3b2" }}>
            Compiled SQL · dry-run cost · diagnostics · dependency graphs
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#9aa3b2" }}>
          <span>by {site.author.name}</span>
          <span>VS Code · Cursor · Antigravity</span>
        </div>
      </div>
    ),
    size
  );
}
