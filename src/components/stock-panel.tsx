"use client";

import { SplashLink as Link } from "@/components/splash-provider";
import { ArrowUpRight, Truck } from "lucide-react";
import type { ShipmentDTO, StockRowDTO } from "@/lib/domain";
import { fmtInt, fmtShort, packLabel } from "@/lib/client";
import { Button, ProductTag } from "@/components/ui";

/** Etapa 4: saldo consolidado de caixas prontas, por produto e embalagem. */
export function StockPanel({
  stock,
  shipments,
  canShip,
  onShip,
}: {
  stock: StockRowDTO[];
  shipments: ShipmentDTO[];
  canShip: boolean;
  onShip: () => void;
}) {
  const available = stock.filter((s) => s.balance > 0);
  const totalBoxes = available.reduce((acc, s) => acc + s.balance, 0);

  const groups = new Map<number, StockRowDTO[]>();
  for (const row of available) groups.set(row.productId, [...(groups.get(row.productId) ?? []), row]);

  return (
    <section aria-label="Saldo consolidado de caixas" className="overflow-hidden rounded-lg border border-ink bg-card">
      <div className="flex items-end justify-between gap-2 bg-ink px-3 py-3 text-paper">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-paper/65">Saldo consolidado</p>
          <p className="display tnum mt-1 text-[36px]">
            {fmtInt(totalBoxes)} <span className="text-[15px] tracking-wide text-hivis">caixas</span>
          </p>
        </div>
        {canShip && (
          <span className="on-dark">
            <Button size="sm" variant="hivis" icon={<Truck aria-hidden className="size-4" />} onClick={onShip} disabled={available.length === 0}>
              Separar pedido
            </Button>
          </span>
        )}
      </div>

      {groups.size === 0 ? (
        <p className="px-3 py-4 text-sm text-ink-3">Sem caixas disponíveis. O saldo aparece aqui assim que o Acabamento finalizar um lote.</p>
      ) : (
        <ul className="divide-y divide-line">
          {[...groups.values()].map((rows) => (
            <li key={rows[0].productId} className="px-3 py-2.5">
              <ProductTag brand={rows[0].brand} format={rows[0].format} />
              <ul className="mt-2 space-y-1">
                {rows.map((r) => (
                  <li key={r.packagingOptionId} className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-ink-2">{packLabel(r.label, r.unitsPerBox)}</span>
                    <span className="shrink-0 text-right">
                      <span className="tnum text-[15px] font-bold text-ink">{fmtInt(r.balance)}</span>{" "}
                      <span className="text-ink-2">cx</span>
                      <span className="tnum ml-1.5 text-xs text-ink-3">{fmtInt(r.balance * r.unitsPerBox)} un</span>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Link href="/estoque" className="flex min-h-10 items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs font-semibold text-ink-2 transition hover:bg-paper-deep/50 hover:text-ink">
        Gerenciar estoque <ArrowUpRight aria-hidden className="size-3.5" />
      </Link>

      {shipments.length > 0 && (
        <details className="border-t border-line">
          <summary className="flex min-h-10 items-center px-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3 hover:text-ink">
            Últimas separações
          </summary>
          <ul className="space-y-2 px-3 pb-3">
            {shipments.map((s) => (
              <li key={s.id} className="text-xs text-ink-2">
                <span className="font-mono font-semibold text-ink">{s.orderRef}</span>
                {s.customer && <span> · {s.customer}</span>}
                <br />
                <span className="tnum font-semibold text-ink">{fmtInt(s.boxes)}</span> × {s.brand} {s.format} · {s.label}
                <br />
                <span className="text-ink-3">
                  {fmtShort(s.createdAt)} · {s.createdByName}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
