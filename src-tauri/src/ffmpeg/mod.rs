pub mod locate;
pub mod probe;
pub mod progress;
pub mod run;
pub mod waveform;

use std::ffi::OsStr;
use std::process::Command;

/// Create a std::process::Command configured with CREATE_NO_WINDOW on Windows
/// to prevent console prompt window flashing.
#[allow(unused_mut)]
pub fn create_hidden_command<P: AsRef<OsStr>>(program: P) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}
