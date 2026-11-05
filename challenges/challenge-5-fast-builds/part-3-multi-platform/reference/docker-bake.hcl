# A bake file describes builds as data, so the same file works on a laptop and in CI.
# Run it from the root of your repository, after you prepared the build folder (see the README):
#   docker buildx bake -f challenges/challenge-5-fast-builds/part-3-multi-platform/docker-bake.hcl app
# One name, two CPU architectures: amd64 (most servers and PCs) and arm64 (Apple silicon, Graviton).

variable "TAG" {
  default = "dev"
}

group "default" {
  targets = ["app"]
}

target "app" {
  context    = "build-ctx"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  tags       = ["daftar-api:${TAG}"]
  labels = {
    "org.opencontainers.image.title" = "daftar-api"
  }
}

# One platform, loaded into the local Docker. Use it for a quick local check.
target "app-local" {
  inherits = ["app"]
  platforms = []
  output   = ["type=docker"]
}
