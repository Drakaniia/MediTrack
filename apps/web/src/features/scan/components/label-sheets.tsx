import type { CSSProperties, ReactElement } from "react";

import {
  type LabelModel,
  type LabelSize,
  paginate,
} from "../lib/label-layout";
import { qrMatrixForBatch, qrPathData } from "../lib/label-qr";
import "./labels.css";

const QUIET_ZONE_MODULES = 2;

/** The QR as an inline SVG path (no images, no innerHTML). Always black on white. */
export function LabelQr({ payload }: { payload: string }): ReactElement {
  const { modules, size } = qrMatrixForBatch(payload);
  const extent = size + QUIET_ZONE_MODULES * 2;
  return (
    <svg
      aria-label={`QR code for batch ${payload}`}
      className="label-qr"
      role="img"
      shapeRendering="crispEdges"
      viewBox={`${-QUIET_ZONE_MODULES} ${-QUIET_ZONE_MODULES} ${extent} ${extent}`}
    >
      <rect
        fill="#fff"
        height={extent}
        width={extent}
        x={-QUIET_ZONE_MODULES}
        y={-QUIET_ZONE_MODULES}
      />
      <path d={qrPathData(modules)} fill="#000" />
    </svg>
  );
}

export function LabelCard({ label }: { label: LabelModel }): ReactElement {
  return (
    <div className="label" data-testid="label">
      <LabelQr payload={label.qrPayload} />
      <div className="label-text">
        <p className="label-title">{label.title}</p>
        <p className="label-line">Lot {label.batchNumber}</p>
        <p className="label-line">{label.expiryText}</p>
        <p className="label-code">{label.codeDisplay}</p>
      </div>
    </div>
  );
}

function sheetStyle(size: LabelSize): CSSProperties {
  return {
    "--cols": size.columns,
    "--label-h": `${size.labelHeightMm}mm`,
    "--label-w": `${size.labelWidthMm}mm`,
    "--page-h": `${size.pageHeightMm}mm`,
    "--page-w": `${size.pageWidthMm}mm`,
    "--qr": `${size.qrMm}mm`,
  } as CSSProperties;
}

export interface LabelSheetsProps {
  labels: readonly LabelModel[];
  size: LabelSize;
}

/** The labels laid out page by page, exactly as they will print. */
export function LabelSheets({ labels, size }: LabelSheetsProps): ReactElement {
  const pages = paginate(labels, size);
  return (
    <>
      {pages.map((page, index) => (
        <div
          className="label-sheet"
          data-testid="label-sheet"
          key={page[0]?.key ?? `page-${index}`}
          style={sheetStyle(size)}
        >
          {page.map((label) => (
            <LabelCard key={label.key} label={label} />
          ))}
        </div>
      ))}
    </>
  );
}
