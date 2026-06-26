-- Migration 130: kundensegment Enum um Produzent + Weinhauer erweitern
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'produzent';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'weinhauer';
