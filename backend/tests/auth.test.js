/**
 * Unit Tests for CRIP Authentication Module
 * Run: npx jest backend/tests/auth.test.js
 */

const { describe, it, expect } = require('@jest/globals');

// ─────────────────────────────────────────────
// Shared Utils Tests
// ─────────────────────────────────────────────
const { escapeHtml } = require('../utils/shared');

describe('escapeHtml', () => {
    it('should escape ampersands', () => {
        expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape angle brackets', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape single quotes', () => {
        expect(escapeHtml("it's")).toBe("it&#039;s");
    });

    it('should handle empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('should handle numbers by converting to string', () => {
        expect(escapeHtml(42)).toBe('42');
    });

    it('should handle null/undefined gracefully', () => {
        expect(escapeHtml(null)).toBe('null');
        expect(escapeHtml(undefined)).toBe('undefined');
    });
});

// ─────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────
describe('Registration Input Validation', () => {
    const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const validatePassword = (pw) => pw && pw.length >= 6;
    const validateName = (name) => name && name.trim().length >= 2;

    it('should accept valid email', () => {
        expect(validateEmail('user@mgit.ac.in')).toBe(true);
        expect(validateEmail('test.user@gmail.com')).toBe(true);
    });

    it('should reject invalid email', () => {
        expect(validateEmail('')).toBe(false);
        expect(validateEmail('notanemail')).toBe(false);
        expect(validateEmail('missing@domain')).toBe(false);
    });

    it('should accept valid passwords (6+ chars)', () => {
        expect(validatePassword('secure123')).toBe(true);
        expect(validatePassword('abcdef')).toBe(true);
    });

    it('should reject short passwords', () => {
        expect(validatePassword('12345')).toBe(false);
        expect(validatePassword('')).toBe(false);
        expect(validatePassword(null)).toBe(false);
    });

    it('should accept valid names', () => {
        expect(validateName('Rithik')).toBe(true);
        expect(validateName('A B')).toBe(true);
    });

    it('should reject empty/short names', () => {
        expect(validateName('')).toBe(false);
        expect(validateName(' ')).toBe(false);
        expect(validateName('A')).toBe(false);
    });
});

// ─────────────────────────────────────────────
// Risk Level Classification Tests
// ─────────────────────────────────────────────
describe('Risk Level Classification', () => {
    function classifyRisk(score) {
        if (score >= 75) return 'High Risk';
        if (score >= 40) return 'Warning';
        return 'Safe';
    }

    it('should classify scores >= 75 as High Risk', () => {
        expect(classifyRisk(100)).toBe('High Risk');
        expect(classifyRisk(75)).toBe('High Risk');
        expect(classifyRisk(88)).toBe('High Risk');
    });

    it('should classify scores 40-74 as Warning', () => {
        expect(classifyRisk(40)).toBe('Warning');
        expect(classifyRisk(60)).toBe('Warning');
        expect(classifyRisk(74)).toBe('Warning');
    });

    it('should classify scores < 40 as Safe', () => {
        expect(classifyRisk(0)).toBe('Safe');
        expect(classifyRisk(20)).toBe('Safe');
        expect(classifyRisk(39)).toBe('Safe');
    });
});

// ─────────────────────────────────────────────
// Health Score Computation Tests
// ─────────────────────────────────────────────
describe('Health Score Computation', () => {
    function computeHealthScore(customers) {
        if (!customers || customers.length === 0) return 0;
        const total = customers.reduce((sum, c) => sum + (c.health_score || 0), 0);
        return Math.round(total / customers.length);
    }

    it('should compute average health score', () => {
        const customers = [
            { health_score: 80 },
            { health_score: 60 },
            { health_score: 40 }
        ];
        expect(computeHealthScore(customers)).toBe(60);
    });

    it('should handle empty array', () => {
        expect(computeHealthScore([])).toBe(0);
    });

    it('should handle customers with missing health_score', () => {
        const customers = [{ health_score: 100 }, {}, { health_score: 50 }];
        expect(computeHealthScore(customers)).toBe(50);
    });
});
