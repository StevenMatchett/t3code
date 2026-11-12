# A clean machine for `npx t3tui`: Debian with systemd as PID 1, a normal user
# whose systemd --user manager runs at boot (lingering), and only Node and git.
# No repository, no build tools, no provider CLIs. Driven by scripts/docker-test.mjs.
FROM debian:bookworm-slim

ARG NODE_VERSION=26.8.2
ARG TARGETARCH
# 1 preinstalls Claude Code for the test user. Off by default: a new user has no providers.
ARG INSTALL_CLAUDE=0

ENV container=docker DEBIAN_FRONTEND=noninteractive

# libatomic1: official Node 26 Linux binaries link against it. The masked units
# make no sense in a container and slow or break boot.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    systemd systemd-sysv dbus dbus-user-session \
    ca-certificates curl xz-utils git procps less locales libatomic1 vim \
  && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
  && rm -rf /var/lib/apt/lists/* \
  && systemctl mask systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket \
    systemd-modules-load.service sys-kernel-config.mount sys-kernel-debug.mount \
    systemd-remount-fs.service getty.target console-getty.service

RUN case "${TARGETARCH:-amd64}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) exit 1 ;; esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE \
  && node --version && npm --version

# A login user with lingering, so `systemctl --user` works without a desktop session.
RUN useradd --create-home --uid 1000 --shell /bin/bash tester \
  && mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/tester \
  && printf '%s\n' \
    'export XDG_RUNTIME_DIR=/run/user/1000' \
    'export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus' \
    'export LANG=en_US.UTF-8 TERM=${TERM:-xterm-256color} EDITOR=vim' \
    >> /home/tester/.profile

# The download is ~340 MB, so it lives in its own cached layer. Debian's .profile
# puts ~/.local/bin, where it installs, on PATH at login.
USER tester
RUN if [ "$INSTALL_CLAUDE" = 1 ]; then \
    curl -fsSL https://claude.ai/install.sh | bash && /home/tester/.local/bin/claude --version; \
  fi
USER root

ENV LANG=en_US.UTF-8
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
