// src/pickleball-open/lib/greeting.test.js
import { describe, expect, it } from 'vitest'
import { greetingFor } from './greeting'

const at = (hour, minute = 0) => new Date(2026, 9, 13, hour, minute)

describe('greetingFor', () => {
  it('greets by the hour on this device', () => {
    expect(greetingFor(at(5))).toBe('Good morning, players 👋')
    expect(greetingFor(at(11, 59))).toBe('Good morning, players 👋')
    expect(greetingFor(at(12))).toBe('Good afternoon, players 👋')
    expect(greetingFor(at(17, 59))).toBe('Good afternoon, players 👋')
    expect(greetingFor(at(18))).toBe('Good evening, players 👋')
    expect(greetingFor(at(23, 30))).toBe('Good evening, players 👋')
    expect(greetingFor(at(0))).toBe('Good evening, players 👋')
    expect(greetingFor(at(4, 59))).toBe('Good evening, players 👋')
  })
})
