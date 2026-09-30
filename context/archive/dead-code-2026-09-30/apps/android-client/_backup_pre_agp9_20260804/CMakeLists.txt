cmake_minimum_required(VERSION 3.22.1)
project("gamepad_engine")

add_library(${CMAKE_PROJECT_NAME} SHARED gamepad-engine.cpp)

# 16 KB page-size support: NDK 25 (in use here) still defaults the linker to 4 KB
# ELF LOAD-segment alignment (this only became default in NDK r27+). Set it
# explicitly so the engine's own .so is fully compatible with 16 KB-page devices,
# not just zip-container aligned (which AGP 8.6.1 already handles separately).
target_link_options(${CMAKE_PROJECT_NAME} PRIVATE "-Wl,-z,max-page-size=16384")

# Strictly link Android Input and Logging libraries
target_link_libraries(${CMAKE_PROJECT_NAME}
        android
        log
        # Oboe or AAudio goes here later when we add the Rx Rumble Thread
)
