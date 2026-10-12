// src/pickleball-open/lib/greeting.js
// The greeting above the welcome message, worked out on each viewer's own
// device from its local time (spec 2026-10-13 §A).

/** "Good morning/afternoon/evening, players 👋" for the hour of `date`. */
export function greetingFor(date) {
  const hour = date.getHours()
  const part = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening'
  return `Good ${part}, players 👋`
}
