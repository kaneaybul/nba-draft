args <- commandArgs(TRUE)
repo <- args[1]
out <- args[2]
score <- readLines(file.path(repo,"script/models/score_career_projection_models.R"))
train <- readLines(file.path(repo,"script/models/train_career_projection_models.R"))
eval(parse(text=train[seq_len(match("base_dir <- resolve_base_dir()", train)-1)]))
source(file.path(repo, "script/data/darko_dpm_fallback.R"))
panel <- build_panel(repo)
all_gp <- build_bref_gp_rows(repo)
artifact <- readRDS(file.path(repo,"processed/modelresults/career_projection_models.rds"))
rows <- make_one_year_rows(panel)
block <- score[match("models <- artifact$models",score):(match("projection_dir <- file.path(base_dir, \"processed\", \"livedata\", \"impactrefresh\")",score)-1)]
block <- block[block!="panel <- build_panel(base_dir)"]
for (origin in 2022:2025) {
  full <- panel
  panel <- panel[panel$year<=origin,]
  orig_artifact <- artifact
  for (target in names(artifact$models)) {
    obj <- artifact$models[[target]]
    df <- if(target=="target_games") all_gp[all_gp$year<origin,] else rows[rows$target_year<=origin & rows$target_exists==1,]
    fit <- lm(reformulate(obj$features,target),data=df)
    artifact$models[[target]]$model <- list(algorithm="lm",features=obj$features,fit=fit)
  }
  eval(parse(text=block))
  write.csv(do.call(rbind,predictions),file.path(out,paste0("historical_",origin,".csv")),row.names=FALSE)
  panel <- full
  artifact <- orig_artifact
}
