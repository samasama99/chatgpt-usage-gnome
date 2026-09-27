UUID := chatgpt-usage@samasama99

.PHONY: build test check pack install clean

build:
	npm run build

test:
	npm test

check:
	npm run check

pack: build
	cd extension && zip -qr ../$(UUID).shell-extension.zip .

install: build
	./install.sh

clean:
	rm -rf dist node_modules $(UUID).shell-extension.zip
