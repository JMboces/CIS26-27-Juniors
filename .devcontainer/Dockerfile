FROM archlinux:latest

RUN pacman -Syu --noconfirm \
    base-devel \
    git \
    sudo \
    curl \
    wget \
    openssh \
    vim \
    nano \
    unzip \
    zip \
    && pacman -Scc --noconfirm

RUN useradd -m -G wheel -s /bin/bash vscode \
    && echo '%wheel ALL=(ALL:ALL) NOPASSWD: ALL' > /etc/sudoers.d/wheel

USER vscode
WORKDIR /workspaces
