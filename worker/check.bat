@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
cargo check --manifest-path "h:\repos\AIForAll\worker\Cargo.toml" > "h:\repos\AIForAll\worker\check_output.txt" 2>&1
echo EXIT_CODE=%ERRORLEVEL% >> "h:\repos\AIForAll\worker\check_output.txt"
