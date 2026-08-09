#!/usr/bin/env bash
#
# Create a self-signed code signing certificate for Stone.
#
# Why this exists
# ---------------
# macOS records a TCC (privacy) grant against a *code requirement*, not against
# a bundle identifier. For an app with no signing certificate there is nothing
# stable to anchor to, so TCC pins the grant to the binary's cdhash:
#
#   cdhash H"4e58324696ef..." or cdhash H"d4aee92466..."
#
# The cdhash changes on every single build, so calendar access granted to one
# build is silently dead in the next one. Signing with a certificate — even a
# self-signed one — changes the recorded requirement to:
#
#   identifier "com.stone.app" and certificate leaf = H"<cert hash>"
#
# which is stable for as long as the certificate is, so the grant survives
# rebuilds and app updates.
#
# A real Apple Developer ID is still the right answer for public distribution
# (it also clears Gatekeeper and allows notarisation). This is the local
# stand-in: `scripts/sign-mac.mjs` prefers a Developer ID whenever one exists.
#
# Usage:  ./scripts/make-signing-cert.sh
# Undo:   security delete-certificate -c "Stone Local Signing"

set -euo pipefail

NAME="Stone Local Signing"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "Certificate \"$NAME\" already exists — nothing to do."
  echo "Delete it with: security delete-certificate -c \"$NAME\""
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Generating a 10-year self-signed code signing certificate…"

# codeSigning EKU is what makes codesign willing to use the identity at all.
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -subj "/CN=${NAME}/O=Stone/C=US" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  2>/dev/null

# OpenSSL 3 defaults to AES-256-CBC with a SHA-256 MAC, which Apple's `security`
# cannot read — it fails as "MAC verification failed (wrong password?)". The
# older PKCS#12 algorithms below are what it expects.
openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$WORK/cert.p12" -passout pass:stone \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 2>/dev/null

# -T grants codesign access to the private key without a prompt per invocation.
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P stone \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null

echo "Imported into the login keychain."

# `security import -T` already names codesign as a trusted client of the key.
# set-key-partition-list additionally suppresses the "codesign wants to use a
# key" dialog, but it needs the login password, so it is never run unattended
# here — a single "Always Allow" on the first build achieves the same thing.
echo
echo "On the first build macOS may show a keychain dialog asking whether"
echo "codesign may use this key. Choose \"Always Allow\" and it will not ask"
echo "again. To suppress it up front instead, run:"
echo
echo "    security set-key-partition-list -S apple-tool:,apple:,codesign: \\"
echo "      -s -k <your-login-password> \"$KEYCHAIN\""

echo
echo "Done. \"$NAME\" is ready; \`npm run dist:mac\` will pick it up."
echo
echo "One-time cleanup, so macOS forgets the grant pinned to the old unsigned"
echo "builds and prompts again against the new signed identity:"
echo
echo "    tccutil reset Calendar com.stone.app"
