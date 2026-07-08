def fib(n: int) -> int:
    """The nth Fibonacci number, bottom-up."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
