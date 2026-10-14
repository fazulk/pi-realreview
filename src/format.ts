export function formatMoney(value: number) {
  return "$" + value.toFixed(value < 1 ? 3 : 2);
}

export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}
