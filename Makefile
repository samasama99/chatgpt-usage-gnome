UUID := quota-monitor@samasama99.github.io

.PHONY: build test check store-check pack install clean

build:
	npm run build

test:
	npm test

check:
	npm run check

store-check:
	npm run store-check

pack: build
	cd extension && zip -qr ../$(UUID).shell-extension.zip .

install: build
	./install.sh

clean:
	rm -rf dist node_modules $(UUID).shell-extension.zip
