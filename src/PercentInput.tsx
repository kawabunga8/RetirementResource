import { useState } from "react";

/**
 * A number input that shows a percentage while the model keeps a decimal rate.
 *
 * The model stores 0.07 because that is what the arithmetic multiplies by.
 * Nobody thinks in 0.07. Every one of these fields used to carry its own
 * instruction -- "Expected nominal return (e.g. 0.07 = 7%)" -- which is a label
 * apologising for its input. Show 7, store 0.07, and the explanation is
 * unnecessary.
 *
 * Rounding is not decoration here: 0.07 * 100 is 7.000000000000001 in binary
 * floating point, and 7.000000000000001 in a number field is worse than the
 * decimal ever was.
 */

const toPercentText = (rate: number): string => {
  if (!Number.isFinite(rate)) return "0";
  return String(Math.round(rate * 1e6) / 1e4);
};

const toRate = (percentText: string): number => {
  const n = Number(percentText);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1e6) / 1e8;
};

export function PercentInput({
  value,
  onChange,
  step = 0.1,
  width = 96,
}: {
  value: number;
  onChange: (rate: number) => void;
  step?: number;
  width?: number;
}) {
  const [text, setText] = useState(() => toPercentText(value));
  const [lastValue, setLastValue] = useState(value);

  // Resync when the value changes from outside -- a plan load, or Reset --
  // but never while it is only our own keystrokes moving it, which would
  // fight the user mid-type. This is React's documented adjust-state-during-
  // render pattern rather than an effect, so there is no flash of stale text.
  if (value !== lastValue) {
    setLastValue(value);
    if (toRate(text) !== value) setText(toPercentText(value));
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <input
        type="number"
        step={step}
        value={text}
        style={{ maxWidth: width }}
        onChange={(e) => {
          setText(e.target.value);
          const rate = toRate(e.target.value);
          // An empty or half-typed field ("", "-", ".") must not write NaN
          // into the plan and blow up every projection downstream.
          if (Number.isFinite(rate)) onChange(rate);
        }}
        onBlur={() => setText(toPercentText(value))}
      />
      <span style={{ fontSize: 13, opacity: 0.7 }}>%</span>
    </span>
  );
}
