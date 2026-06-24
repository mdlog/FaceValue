# FaceValue Soroban contract — build/test helpers.
# Requires the wasm32v1-none target: `rustup target add wasm32v1-none`
# (soroban-sdk 25.x does NOT support wasm32-unknown-unknown on Rust 1.82+).

TARGET = wasm32v1-none

default: build

all: test

build:
	cargo build --target $(TARGET) --release
	@ls -l target/$(TARGET)/release/*.wasm

# `stellar contract build` is equivalent if the Stellar CLI is installed.
stellar-build:
	stellar contract build

test:
	cargo test --release

fmt:
	cargo fmt --all

clean:
	cargo clean
