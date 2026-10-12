// A cell opening with = + - @ is executed as a formula by Excel and Sheets.
// Player names are user input, so text cells are prefixed with ' to defuse that.
export function csvText(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe
}
