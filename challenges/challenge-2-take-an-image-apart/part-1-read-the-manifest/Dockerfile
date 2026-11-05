# The image you take apart in part 1. Small on purpose: a few layers you can read one by one.
FROM alpine:3.23
LABEL dkr.challenge="2"
WORKDIR /app
ENV GREETING="hello from layer land"
COPY notes.txt /app/notes.txt
RUN echo "step one" > /app/one.txt
RUN echo "step two" > /app/two.txt && echo "step three" > /app/three.txt
CMD ["cat", "/app/notes.txt"]
