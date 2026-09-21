# The app. One stage: there is nothing to compile — npm run build only copies
# the Lottie player out of node_modules, and the emoji JSON is vendored into
# the repo (scripts/vendor-emoji.js, run by hand, output committed) so the
# image build never reaches the network.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=1000:1000 . .
# After the source copy: the script reads node_modules and writes into
# public/vendor/. A committed copy of the player is already there, so this is
# a refresh rather than a dependency of the build.
RUN node scripts/copy-vendor.js && chown -R 1000:1000 public/vendor
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
# Kubernetes enforces runAsNonRoot without supplying a UID. Keep this numeric:
# unlike a symbolic USER, it lets the kubelet verify the image before startup.
USER 1000:1000
CMD ["node", "server.js"]
