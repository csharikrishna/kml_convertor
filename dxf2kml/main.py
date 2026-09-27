"""
Main CLI entry point for DXF2KML converter using Typer and Loguru.
"""

import sys
import time
from pathlib import Path
from typing import Optional
import typer
from rich.console import Console
from rich.panel import Panel
from loguru import logger

from dxf2kml import __version__
from dxf2kml.config import ConverterConfig
from dxf2kml.errors import ConversionError
from dxf2kml.pipeline import convert as run_conversion
from dxf2kml.transformer import normalize_crs_input

app = typer.Typer(
    name="dxf2kml",
    help="Production-grade AutoCAD DXF to Google Earth KML Converter",
    add_completion=False,
)
console = Console()


def version_callback(value: bool):
    if value:
        console.print(f"[bold green]dxf2kml[/bold green] version [cyan]{__version__}[/cyan]")
        raise typer.Exit()


@app.command()
def web(
    host: str = typer.Option("0.0.0.0", "--host", "-h", help="Host address to bind the web server"),
    port: int = typer.Option(8000, "--port", "-p", help="Port number for the web server"),
    reload: bool = typer.Option(False, "--reload", help="Enable auto-reload for development"),
):
    """Launch the DXF to KML Online Web Application interface."""
    import uvicorn
    console.print(Panel.fit(
        f"[bold blue]DXF -> KML Web Converter Server[/bold blue]\n"
        f"URL: [cyan]http://localhost:{port}[/cyan]",
        title="Web Server Started"
    ))
    uvicorn.run("web_app.app:app", host=host, port=port, reload=reload)


@app.command()
def convert(
    input: Path = typer.Option(
        ...,
        "--input", "-i",
        help="Path to input AutoCAD DXF file",
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output", "-o",
        help="Path to output KML file (defaults to input filename with .kml extension)",
    ),
    input_epsg: Optional[str] = typer.Option(
        None,
        "--input-epsg",
        help="Input Coordinate Reference System (e.g. 32644 or EPSG:32644)",
    ),
    output_epsg: Optional[str] = typer.Option(
        None,
        "--output-epsg",
        help="Output Coordinate Reference System (default EPSG:4326)",
    ),
    ignore_large_polygons: Optional[bool] = typer.Option(
        None,
        "--ignore-large-polygons/--no-ignore-large-polygons",
        help="Filter out sheet borders and construction layout boxes",
    ),
    merge_lines: Optional[bool] = typer.Option(
        None,
        "--merge-lines/--no-merge-lines",
        help="Merge touching line segments into continuous LineStrings/Polygons",
    ),
    merge_distance: Optional[float] = typer.Option(
        None,
        "--merge-distance",
        help="Maximum distance tolerance (in input CRS units) to merge line vertices",
    ),
    export_text: Optional[bool] = typer.Option(
        None,
        "--export-text/--no-export-text",
        help="Export TEXT and MTEXT entities as Google Earth Placemarks",
    ),
    export_points: Optional[bool] = typer.Option(
        None,
        "--export-points/--no-export-points",
        help="Export POINT entities as Google Earth Placemarks",
    ),
    label_scale: Optional[float] = typer.Option(
        None,
        "--label-scale",
        help="Scale factor for KML text labels (e.g. 0.5 for small, 0.7 for medium, 1.0 for standard)",
    ),
    config_file: Optional[Path] = typer.Option(
        None,
        "--config", "-c",
        help="Path to YAML configuration file",
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose", "-v",
        help="Enable detailed debug logging",
    ),
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        callback=version_callback,
        is_eager=True,
        help="Show program version and exit",
    ),
):
    """Convert an AutoCAD DXF/DWG drawing to Google Earth KML (or KMZ if the output ends in .kmz)."""
    start_time = time.time()

    # Configure Loguru logging
    logger.remove()
    log_level = "DEBUG" if verbose else "INFO"
    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss}</green> | <level>{level:7}</level> | <level>{message}</level>",
        level=log_level,
    )

    # 1. Load base configuration (from YAML if provided, else defaults)
    if config_file:
        cfg = ConverterConfig.from_yaml(config_file)
        logger.info(f"Loaded configuration from YAML: {config_file}")
    else:
        cfg = ConverterConfig()

    # 2. Override config with CLI arguments if specified
    if input_epsg:
        cfg.input_epsg = normalize_crs_input(input_epsg)
    if output_epsg:
        cfg.output_epsg = normalize_crs_input(output_epsg)
    if ignore_large_polygons is not None:
        cfg.ignore_large_polygons = ignore_large_polygons
    if merge_lines is not None:
        cfg.merge_lines = merge_lines
    if merge_distance is not None:
        cfg.merge_distance = merge_distance
    if export_text is not None:
        cfg.export_text = export_text
    if export_points is not None:
        cfg.export_points = export_points
    if label_scale is not None:
        cfg.default_label_scale = label_scale

    # Determine default output path if not provided
    if output is None:
        output = input.with_suffix(".kml")

    console.print(Panel.fit(
        f"[bold blue]DXF -> KML Converter[/bold blue]\n"
        f"Input: [cyan]{input}[/cyan]\n"
        f"Output: [cyan]{output}[/cyan]\n"
        f"CRS: [yellow]{cfg.input_epsg}[/yellow] -> [yellow]{cfg.output_epsg}[/yellow]",
        title="Processing Run"
    ))

    # 3. Run the conversion pipeline (parse -> geometry -> filter -> CRS -> KML/KMZ)
    try:
        result = run_conversion(input, output, cfg)
    except ConversionError as ex:
        console.print(f"[bold red]Conversion failed:[/bold red] {ex}")
        raise typer.Exit(code=1) from None

    elapsed_time = time.time() - start_time

    # 4. Output formatted summary
    console.print("\n[bold green]==================================================[/bold green]")
    console.print(f"[bold white]Loaded [cyan]{result.parse_result.total_entities_processed}[/cyan] entities[/bold white]")
    console.print(f"[bold white]Merged [cyan]{result.geometry_stats.merged_lines_count}[/cyan] line segments[/bold white]")
    console.print(f"[bold white]Ignored [cyan]{result.ignored_frames}[/cyan] construction rectangles[/bold white]")
    console.print("[bold white]Exported[/bold white]")
    console.print(f"  [green]{result.export_stats.polygons_exported}[/green] polygons")
    console.print(f"  [green]{result.export_stats.polylines_exported}[/green] polylines")
    console.print(f"  [green]{result.export_stats.points_exported}[/green] points")
    console.print(f"  [green]{result.export_stats.labels_exported}[/green] labels")
    for warning in result.warnings:
        console.print(f"[bold yellow]Warning:[/bold yellow] {warning}")
    console.print(f"[bold yellow]Finished in {elapsed_time:.2f} seconds[/bold yellow]")
    console.print("[bold green]==================================================[/bold green]\n")


def main():
    app()


if __name__ == "__main__":
    main()
