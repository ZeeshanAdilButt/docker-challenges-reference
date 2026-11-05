# A bake file describes builds as data, so the same file works on a laptop and in CI.
# Run it from the root of your repository, after you prepared the build folder (see the README):
#   docker buildx bake -f challenges/challenge-5-fast-builds/part-3-multi-platform/docker-bake.hcl app
# Today it builds for one platform only. Your job: build for amd64 and arm64.

variable "TAG" {
  default = "dev"
}

group "default" {
  targets = ["app"]
}

target "app" {
  context    = "build-ctx"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = ["daftar-api:${TAG}"]
  labels = {
    "org.opencontainers.image.title" = "daftar-api"
  }
}
