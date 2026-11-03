use serde::Serialize;
use std::{
    io::{BufRead, BufReader, BufWriter, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

const ENGINE_RELATIVE_PATH: &str = "resources/stockfish/stockfish.exe";
const START_TIMEOUT: Duration = Duration::from_secs(12);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Default)]
pub struct StockfishState(pub Mutex<Option<StockfishProcess>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EngineLine {
    request_id: u64,
    line: String,
}

#[derive(Serialize, Clone)]
struct EngineExit {
    reason: String,
}

pub struct StockfishProcess {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    receiver: Receiver<String>,
    searching: Arc<AtomicBool>,
    request_id: Arc<AtomicU64>,
}

impl StockfishProcess {
    fn send(&mut self, command: &str) -> Result<(), String> {
        writeln!(self.stdin, "{command}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Comunicazione con Stockfish non riuscita: {error}"))
    }

    fn wait_for<F>(&self, timeout: Duration, description: &str, predicate: F) -> Result<String, String>
    where
        F: Fn(&str) -> bool,
    {
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("Timeout Stockfish: {description}."));
            }
            match self.receiver.recv_timeout(remaining) {
                Ok(line) if predicate(&line) => return Ok(line),
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!("Timeout Stockfish: {description}."));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("Stockfish ha chiuso il canale di comunicazione.".into());
                }
            }
        }
    }

    fn stop_search(&mut self) -> Result<(), String> {
        if !self.searching.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.send("stop")?;
        self.wait_for(COMMAND_TIMEOUT, "arresto dell'analisi", |line| {
            line.starts_with("bestmove ")
        })?;
        self.searching.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn ensure_alive(&mut self) -> Result<(), String> {
        match self.child.try_wait() {
            Ok(None) => Ok(()),
            Ok(Some(status)) => Err(format!("Stockfish è terminato ({}). Riavvia il motore.", status)),
            Err(error) => Err(format!("Impossibile controllare Stockfish: {error}")),
        }
    }

    fn shutdown(&mut self) {
        let _ = self.stop_search();
        let _ = self.send("quit");
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(40)),
                _ => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for StockfishProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn is_valid_fen(fen: &str) -> bool {
    let fields: Vec<&str> = fen.split_whitespace().collect();
    if fields.len() != 6 || fen.chars().any(|character| matches!(character, '\n' | '\r' | '\0')) {
        return false;
    }

    let ranks: Vec<&str> = fields[0].split('/').collect();
    if ranks.len() != 8 {
        return false;
    }
    let mut white_kings = 0;
    let mut black_kings = 0;
    for rank in ranks {
        let mut squares = 0;
        for character in rank.chars() {
            match character {
                '1'..='8' => squares += character.to_digit(10).unwrap_or(0),
                'K' => {
                    white_kings += 1;
                    squares += 1;
                }
                'k' => {
                    black_kings += 1;
                    squares += 1;
                }
                'p' | 'n' | 'b' | 'r' | 'q'
                | 'P' | 'N' | 'B' | 'R' | 'Q' => squares += 1,
                _ => return false,
            }
        }
        if squares != 8 {
            return false;
        }
    }
    if white_kings != 1 || black_kings != 1 {
        return false;
    }

    if !matches!(fields[1], "w" | "b") {
        return false;
    }
    if fields[2] != "-" && fields[2].chars().any(|c| !matches!(c, 'K' | 'Q' | 'k' | 'q')) {
        return false;
    }
    if fields[3] != "-" {
        let bytes = fields[3].as_bytes();
        if bytes.len() != 2
            || !(b'a'..=b'h').contains(&bytes[0])
            || !(bytes[1] == b'3' || bytes[1] == b'6')
        {
            return false;
        }
    }
    fields[4].parse::<u32>().is_ok() && fields[5].parse::<u32>().is_ok_and(|n| n > 0)
}

fn spawn_engine(app: &AppHandle, path: &Path) -> Result<StockfishProcess, String> {
    let mut command = Command::new(path);
    command
        .current_dir(path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Avvio di Stockfish non riuscito: {error}"))?;
    let stdin = child.stdin.take().ok_or("Input Stockfish non disponibile.")?;
    let stdout = child.stdout.take().ok_or("Output Stockfish non disponibile.")?;
    let (sender, receiver) = mpsc::channel::<String>();
    let searching = Arc::new(AtomicBool::new(false));
    let request_id = Arc::new(AtomicU64::new(0));

    let reader_searching = Arc::clone(&searching);
    let reader_request_id = Arc::clone(&request_id);
    let reader_app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.starts_with("bestmove ") {
                reader_searching.store(false, Ordering::SeqCst);
            }
            let _ = reader_app.emit(
                "stockfish://line",
                EngineLine {
                    request_id: reader_request_id.load(Ordering::SeqCst),
                    line: line.clone(),
                },
            );
            if sender.send(line).is_err() {
                break;
            }
        }
        let _ = reader_app.emit(
            "stockfish://exit",
            EngineExit { reason: "Stockfish ha chiuso il processo.".into() },
        );
    });

    Ok(StockfishProcess {
        child,
        stdin: BufWriter::new(stdin),
        receiver,
        searching,
        request_id,
    })
}

#[tauri::command]
pub fn stockfish_start(app: AppHandle, state: State<'_, StockfishState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Stato Stockfish non disponibile.".to_string())?;
    if let Some(engine) = guard.as_mut() {
        if engine.child.try_wait().map_err(|error| error.to_string())?.is_none() {
            return Ok(());
        }
        guard.take();
    }

    let executable = app.path()
        .resolve(ENGINE_RELATIVE_PATH, BaseDirectory::Resource)
        .map_err(|error| format!("Risorsa Stockfish non trovata: {error}"))?;
    if !executable.is_file() {
        return Err(format!(
            "Stockfish non è incluso nell'installazione. Atteso: {}. Esegui npm run stockfish:install e ricrea l'app.",
            executable.display()
        ));
    }

    let mut engine = spawn_engine(&app, &executable)?;
    engine.send("uci")?;
    engine.wait_for(START_TIMEOUT, "handshake UCI", |line| line == "uciok")?;
    engine.send("isready")?;
    engine.wait_for(START_TIMEOUT, "inizializzazione", |line| line == "readyok")?;
    *guard = Some(engine);
    Ok(())
}

#[tauri::command]
pub fn stockfish_analyze(
    state: State<'_, StockfishState>,
    fen: String,
    depth: u8,
    multi_pv: u8,
    request_id: u64,
) -> Result<(), String> {
    if !is_valid_fen(&fen) {
        return Err("FEN non valida per l'analisi.".into());
    }
    let depth = depth.clamp(1, 30);
    let multi_pv = multi_pv.clamp(1, 5);
    let mut guard = state.0.lock().map_err(|_| "Stato Stockfish non disponibile.".to_string())?;
    let engine = guard.as_mut().ok_or("Avvia prima Stockfish.")?;
    if let Err(error) = engine.ensure_alive() {
        guard.take();
        return Err(error);
    }
    engine.stop_search()?;
    engine.send(&format!("setoption name MultiPV value {multi_pv}"))?;
    engine.send("ucinewgame")?;
    engine.send("isready")?;
    engine.wait_for(COMMAND_TIMEOUT, "preparazione della posizione", |line| line == "readyok")?;
    engine.request_id.store(request_id, Ordering::SeqCst);
    engine.send(&format!("position fen {fen}"))?;
    engine.searching.store(true, Ordering::SeqCst);
    if let Err(error) = engine.send(&format!("go depth {depth}")) {
        engine.searching.store(false, Ordering::SeqCst);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn stockfish_stop_analysis(state: State<'_, StockfishState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Stato Stockfish non disponibile.".to_string())?;
    let engine = guard.as_mut().ok_or("Stockfish non è avviato.")?;
    if let Err(error) = engine.stop_search() {
        guard.take();
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn stockfish_shutdown(state: State<'_, StockfishState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Stato Stockfish non disponibile.".to_string())?;
    guard.take();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_valid_fen;

    #[test]
    fn accepts_initial_and_non_standard_fen_positions() {
        assert!(is_valid_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
        assert!(is_valid_fen("8/8/8/8/8/8/4k3/4K3 b - - 12 45"));
    }

    #[test]
    fn rejects_invalid_or_injectable_fen_strings() {
        assert!(!is_valid_fen(""));
        assert!(!is_valid_fen("startpos"));
        assert!(!is_valid_fen("8/8/8/8/8/8/8/8 w - - 0 1"));
        assert!(!is_valid_fen("8/8/8/8/8/8/8/8 w - - 0 1\nquit"));
        assert!(!is_valid_fen("8/8/8/8/8/8/8/8 x - - 0 1"));
    }
}
