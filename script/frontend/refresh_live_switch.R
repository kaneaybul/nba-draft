# Score the same SWITCH terms as the historical model, using historical-only
# residual controls. Never refit coefficients on an opening-week sample.
base_dir <- getwd()
path <- file.path(base_dir,'raw/live/skill_stats.json')
feed <- jsonlite::fromJSON(path,simplifyVector=FALSE)
assignment <- feed$switch_assignments
updated <- 0L
if(length(assignment)>0) {
  library(dplyr)
  library(readr)
  source(file.path(base_dir,'script/nbamodel/perimeter_defense_features.R'))
  hist <- readr::read_csv(file.path(base_dir,'processed/livedata/impactrefresh/defdata.csv'),show_col_types=FALSE)
  hist <- hist[hist$year<feed$season,]
  hist <- add_perimeter_alloc_residual(hist,base_dir)
  terms <- c('is_center','d_Blocks_Per100','d_DefRebounds_Per100','rimdfga_100','rim_points_saved_100')
  target <- 'perimeter_alloc_points_saved_100'
  training <- hist[!hist$year %in% c(2016,2017) & complete.cases(hist[,c(target,terms)]),]
  if(nrow(training)<100) stop('Historical perimeter calibration is incomplete')
  fit <- lm(perimeter_alloc_points_saved_100 ~ is_center + d_Blocks_Per100 + d_DefRebounds_Per100 + rimdfga_100 + rim_points_saved_100,data=training)
  if(any(!is.finite(coef(fit)))) stop('Invalid historical perimeter calibration')
  coefficients <- read.csv('processed/modelresults/def_lm_1_results.csv',check.names=FALSE)
  estimate <- if('Estimate' %in% names(coefficients)) 'Estimate' else 'estimate'
  beta <- setNames(coefficients[[estimate]],coefficients$term)
  stopifnot(all(c('switch','perimeter_alloc_ps_resid_role') %in% names(beta)))
  for(i in seq_along(feed$players)) {
    p <- feed$players[[i]]; a <- assignment[[as.character(p$nba_id)]]; x <- p$perimeter_inputs
    if(is.null(a)||is.null(x)) next
    needed <- c('points_saved_100','rim_points_saved_100','rimdfga/100','dfga/100','d_FG3A_Per100','d_LongMidRangeFGA_Per100','d_ShortMidRangeFGA_Per100','d_Blocks_Per100','d_DefRebounds_Per100')
    if(any(vapply(needed,function(k) is.null(x[[k]])||!is.finite(x[[k]]),logical(1)))) next
    if(is.null(x$Pos2)||!grepl('[CFG]',x$Pos2)||x[['dfga/100']]<=0||x[['rimdfga/100']]<0) next
    perimeter <- x$d_FG3A_Per100+x$d_LongMidRangeFGA_Per100
    total <- perimeter+x$d_ShortMidRangeFGA_Per100
    if(total<=0||perimeter<0) next
    row <- data.frame(is_center=as.numeric(grepl('C',x$Pos2)),d_Blocks_Per100=x$d_Blocks_Per100,d_DefRebounds_Per100=x$d_DefRebounds_Per100,rimdfga_100=x[['rimdfga/100']],rim_points_saved_100=x$rim_points_saved_100)
    residual <- (x$points_saved_100-x$rim_points_saved_100)*perimeter/total-as.numeric(predict(fit,newdata=row))
    value <- beta[['switch']]*a+beta[['perimeter_alloc_ps_resid_role']]*residual
    if(!is.finite(value)) next
    feed$players[[i]]$raw_skills$SWITCH <- value
    updated <- updated+1L
  }
  feed$switch_status$reason <- paste(updated,'players have complete current assignment and perimeter inputs; other players retain their preseason SWITCH.')
  feed$switch_status$status <- if(updated>0) 'available' else 'perimeter_unavailable'
}
feed$switch_status$updated_players <- updated
feed$held_components <- if(updated==0) list('SWITCH') else list()
feed$note <- feed$switch_status$reason
# Keep only evidence needed for reproducibility; the inputs contain no credentials.
jsonlite::write_json(feed,path,auto_unbox=TRUE,null='null',digits=NA)
message('SWITCH refresh: ',feed$switch_status$status,'; ',updated,' players updated')
