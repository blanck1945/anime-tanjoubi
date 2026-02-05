# Anime Birthday Bot — atajos con una palabra
# Uso: make <target>   ej: make prep   make post N=0   make post-now

.PHONY: help prep prep-test post post-now list dry-run check-supabase test-s3

# Índice del post (default 0). Ej: make post N=2
N ?= 0

help:
	@echo "Anime Birthday Bot — targets:"
	@echo "  make prep         — Prepara posts del día (scrape, imágenes, Gemini, S3, Supabase)"
	@echo "  make prep-test    — Prep de 1 personaje (prueba)"
	@echo "  make post         — Publica el post del día en índice N (default 0). Ej: make post N=2"
	@echo "  make post-now     — Publica 1 personaje ya (el primero del día)"
	@echo "  make list         — Lista cumpleaños de hoy"
	@echo "  make dry-run      — Dry run del flujo"
	@echo "  make check-supabase — Verifica conexión y datos en Supabase"
	@echo "  make test-s3      — Prueba subida/lectura S3"

prep:
	node index.js --prep

prep-test:
	node index.js --prep --limit=1

post:
	node index.js --post=$(N)

post-now:
	node scripts/post-now.js

list:
	node scripts/list-birthdays.js

dry-run:
	node scripts/dry-run.js

check-supabase:
	node scripts/check-supabase.js

test-s3:
	node scripts/test-s3.js
