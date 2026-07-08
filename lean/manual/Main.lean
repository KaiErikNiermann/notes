import VersoManual
import Book

open Verso Doc
open Verso.Genre Manual

open Book

def config : RenderConfig where
  emitTeX := false
  emitHtmlSingle := .no
  emitHtmlMulti := .immediately
  htmlDepth := 1

def main := manualMain (%doc Book) (config := config)
