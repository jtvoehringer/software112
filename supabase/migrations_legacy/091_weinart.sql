-- Migration 091: Weinart auf weingarten-Tabelle
-- Unterscheidung Rotwein / Weißwein / Rosé (Voraussetzung für Verschneidungs-Validierung)

alter table weingarten
  add column if not exists weinart text
    check (weinart in ('rot', 'weiss', 'rose', 'unbekannt'))
    default 'unbekannt';

comment on column weingarten.weinart is 'Weinfarbe: rot | weiss | rose | unbekannt';

-- Auto-Befüllung aus bekannten Rebsorten
update weingarten set weinart = case
  when rebsorte in (
    'Grüner Veltliner', 'Riesling', 'Welschriesling', 'Müller-Thurgau',
    'Chardonnay', 'Sauvignon Blanc', 'Weißburgunder', 'Grauburgunder',
    'Muskateller', 'Neuburger', 'Roter Veltliner', 'Traminer'
  ) then 'weiss'
  when rebsorte in (
    'Zweigelt', 'Blaufränkisch', 'St. Laurent', 'Pinot Noir',
    'Blauburger', 'Merlot', 'Cabernet Sauvignon', 'Syrah',
    'Cabernet Franc', 'Petit Verdot', 'Tannat'
  ) then 'rot'
  else 'unbekannt'
end
where weinart = 'unbekannt' or weinart is null;
